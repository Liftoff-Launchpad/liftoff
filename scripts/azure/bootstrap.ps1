<#
.SYNOPSIS
  One-time, reproducible provisioning of the entire Liftoff platform on Azure.

.DESCRIPTION
  Idempotent end-to-end bootstrap:
    1. Create the resource group
    2. Deploy core infra (main.bicep): ACR, Key Vault, Container Apps env,
       managed identity + GitHub federated credential, storage
    3. Seed Key Vault from apps/api/.env (set-secrets.ps1)
    4. Build & push the three images to ACR (frontends get NEXT_PUBLIC_* baked)
    5. Deploy data services (data.bicep): Postgres + Redis
    6. Deploy app services (apps.bicep): API + web + website

  Requires: az CLI (logged in, correct subscription) and Docker is NOT needed —
  images build server-side with `az acr build`.

.EXAMPLE
  ./scripts/azure/bootstrap.ps1
#>
[CmdletBinding()]
param(
  [string]$ResourceGroup = 'liftoff-rg',
  [string]$Location = 'uaenorth',
  [string]$NamePrefix = 'liftoff',
  [string]$Suffix = '0413',
  [string]$GitHubRepo = 'Liftoff-Launchpad/liftoff',
  [string]$Branch = 'main',
  [string]$EnvFile = "$PSScriptRoot/../../apps/api/.env",
  [switch]$DeployWebsite = $true
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$tag = (git -C $root rev-parse --short=12 HEAD).Trim()

Write-Host "==> [1/6] Resource group" -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location -o none

Write-Host "==> [2/6] Core infra (main.bicep)" -ForegroundColor Cyan
$infra = az deployment group create -g $ResourceGroup -n liftoff-infra `
  --template-file "$root/infra/azure/main.bicep" `
  --parameters location=$Location namePrefix=$NamePrefix suffix=$Suffix githubRepo=$GitHubRepo githubBranch=$Branch `
  --query properties.outputs -o json | ConvertFrom-Json

$acrName        = $infra.acrName.value
$acrLoginServer = $infra.acrLoginServer.value
$envId          = $infra.managedEnvironmentId.value
$defaultDomain  = $infra.defaultDomain.value
$appId          = $infra.appIdentityResourceId.value
$kvName         = $infra.keyVaultName.value
$kvUri          = $infra.keyVaultUri.value
$envStorage     = $infra.envStorageName.value

$apiUrl = "https://$NamePrefix-api.$defaultDomain"
$webUrl = "https://$NamePrefix-web.$defaultDomain"
$ghUrl  = "https://github.com/$GitHubRepo"

Write-Host "==> [3/6] Seed Key Vault from .env" -ForegroundColor Cyan
# First-time provisioning: generate the Postgres password. WARNING: re-running
# bootstrap on an EXISTING deployment will rotate it and break the live DB —
# pass the original via set-secrets.ps1 -PostgresPassword instead in that case.
& "$PSScriptRoot/set-secrets.ps1" -KeyVaultName $kvName -ResourceGroup $ResourceGroup -EnvFile $EnvFile -PostgresAppName "$NamePrefix-postgres" -RotatePostgresPassword

Write-Host "==> [4/6] Build & push images (tag=$tag)" -ForegroundColor Cyan
# ACR Tasks (`az acr build`) are unavailable on this subscription tier, so build
# locally with Docker and push. `az acr login` authorizes docker via the AAD token.
az acr login --name $acrName
docker build -f "$root/Dockerfile.api" -t "$acrLoginServer/liftoff-api:$tag" -t "$acrLoginServer/liftoff-api:latest" $root
docker push "$acrLoginServer/liftoff-api:$tag"; docker push "$acrLoginServer/liftoff-api:latest"
docker build -f "$root/Dockerfile.web" --build-arg "NEXT_PUBLIC_API_URL=$apiUrl" --build-arg "NEXT_PUBLIC_WS_URL=$apiUrl" `
  -t "$acrLoginServer/liftoff-web:$tag" -t "$acrLoginServer/liftoff-web:latest" $root
docker push "$acrLoginServer/liftoff-web:$tag"; docker push "$acrLoginServer/liftoff-web:latest"
docker build -f "$root/Dockerfile.website" --build-arg "NEXT_PUBLIC_API_URL=$apiUrl" --build-arg "NEXT_PUBLIC_APP_URL=$webUrl" --build-arg "NEXT_PUBLIC_GITHUB_URL=$ghUrl" `
  -t "$acrLoginServer/liftoff-website:$tag" -t "$acrLoginServer/liftoff-website:latest" $root
docker push "$acrLoginServer/liftoff-website:$tag"; docker push "$acrLoginServer/liftoff-website:latest"

Write-Host "==> [5/6] Data services (data.bicep)" -ForegroundColor Cyan
az deployment group create -g $ResourceGroup -n liftoff-data `
  --template-file "$root/infra/azure/data.bicep" `
  --parameters location=$Location namePrefix=$NamePrefix managedEnvironmentId=$envId appIdentityResourceId=$appId keyVaultUri=$kvUri envStorageName=$envStorage -o none

Write-Host "==> [6/6] App services (apps.bicep)" -ForegroundColor Cyan
# Non-secret runtime config from .env
$envMap = @{}
foreach ($line in Get-Content $EnvFile) {
  $t = $line.Trim()
  if ($t -eq '' -or $t.StartsWith('#')) { continue }
  $i = $t.IndexOf('='); if ($i -lt 1) { continue }
  $envMap[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"')
}

az deployment group create -g $ResourceGroup -n liftoff-apps `
  --template-file "$root/infra/azure/apps.bicep" `
  --parameters location=$Location namePrefix=$NamePrefix managedEnvironmentId=$envId acrLoginServer=$acrLoginServer `
    appIdentityResourceId=$appId keyVaultUri=$kvUri defaultDomain=$defaultDomain `
    apiImage="$acrLoginServer/liftoff-api:$tag" webImage="$acrLoginServer/liftoff-web:$tag" websiteImage="$acrLoginServer/liftoff-website:$tag" `
    deployWebsite=$($DeployWebsite.IsPresent -or $DeployWebsite) `
    doSpacesBucket=$($envMap['DO_SPACES_BUCKET']) doSpacesEndpoint=$($envMap['DO_SPACES_ENDPOINT']) doSpacesRegion=$($envMap['DO_SPACES_REGION']) -o none

Write-Host "`nDone. URLs:" -ForegroundColor Green
Write-Host "  API:     $apiUrl/api/health"
Write-Host "  Web:     $webUrl"
Write-Host "  Website: https://$NamePrefix-website.$defaultDomain"
Write-Host "`nNext: ./scripts/azure/setup-github.ps1 -Repo $GitHubRepo  (wires CI/CD)"
