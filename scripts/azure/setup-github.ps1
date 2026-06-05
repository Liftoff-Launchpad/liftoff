<#
.SYNOPSIS
  Configure the GitHub repository with the (non-sensitive) Actions variables the
  deploy pipeline needs to authenticate to Azure via OIDC.

.DESCRIPTION
  Reads outputs from the 'liftoff-infra' deployment and sets them as GitHub
  Actions *variables* (not secrets — none of these are sensitive). Requires the
  GitHub CLI (`gh`) to be installed and authenticated (`gh auth login`).

  No application secrets are pushed to GitHub; those live in Azure Key Vault.

.EXAMPLE
  ./scripts/azure/setup-github.ps1 -Repo munimx/liftoff
#>
[CmdletBinding()]
param(
  [string]$Repo = 'munimx/liftoff',
  [string]$ResourceGroup = 'liftoff-rg',
  [string]$DeploymentName = 'liftoff-infra'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) not found. Install it (winget install GitHub.cli) and run 'gh auth login'."
}

Write-Host "Reading deployment outputs from '$DeploymentName'..."
$outputs = az deployment group show -g $ResourceGroup -n $DeploymentName --query properties.outputs -o json | ConvertFrom-Json

$vars = [ordered]@{
  AZURE_CLIENT_ID       = $outputs.cicdIdentityClientId.value
  AZURE_TENANT_ID       = $outputs.tenantId.value
  AZURE_SUBSCRIPTION_ID = $outputs.subscriptionId.value
  AZURE_RG              = $outputs.resourceGroupName.value
  ACR_NAME              = $outputs.acrName.value
  ACR_LOGIN_SERVER      = $outputs.acrLoginServer.value
  ACA_DEFAULT_DOMAIN    = $outputs.defaultDomain.value
}

foreach ($name in $vars.Keys) {
  $value = $vars[$name]
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Output for $name is empty." }
  gh variable set $name --repo $Repo --body $value
  Write-Host "  set var $name = $value"
}

Write-Host "`nGitHub Actions variables configured for $Repo."
Write-Host "Push to 'main' (or run the workflow manually) to trigger a deploy."
