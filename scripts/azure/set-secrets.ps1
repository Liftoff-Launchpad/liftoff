<#
.SYNOPSIS
  Seed Azure Key Vault with Liftoff's runtime secrets from a local .env file.

.DESCRIPTION
  Reads apps/api/.env, generates a Postgres password + DATABASE_URL, and writes
  every secret into the Key Vault via a CONTROL-PLANE Bicep deployment
  (infra/azure/secrets.bicep). This deliberately avoids the data-plane
  `az keyvault secret set`, which on an RBAC vault requires the caller to hold a
  "Key Vault Secrets Officer" role — control-plane secret writes only need the
  Owner/Contributor role the deployer already has.

  Secret values are passed as @secure() parameters via a temp file that is
  deleted immediately and never printed.

  NOTE: a NEW Postgres password is generated each run. Postgres only honours the
  password on first init, so after the database exists, pass -PostgresPassword
  with the original value (or simply don't re-run this) to avoid a mismatch
  between POSTGRES-PASSWORD and DATABASE-URL.

.EXAMPLE
  ./scripts/azure/set-secrets.ps1 -KeyVaultName liftoff-kv-0413 -ResourceGroup liftoff-rg
#>
[CmdletBinding()]
param(
  [string]$KeyVaultName = 'liftoff-kv-0413',
  [string]$ResourceGroup = 'liftoff-rg',
  [string]$EnvFile = "$PSScriptRoot/../../apps/api/.env",
  [string]$PostgresAppName = 'liftoff-postgres',
  [string]$PostgresPassword,
  [switch]$RotatePostgresPassword,
  [string]$SecretsTemplate = "$PSScriptRoot/../../infra/azure/secrets.bicep"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) { throw "Env file not found: $EnvFile" }

# ---- Parse .env --------------------------------------------------------------
$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
  $t = $line.Trim()
  if ($t -eq '' -or $t.StartsWith('#')) { continue }
  $i = $t.IndexOf('='); if ($i -lt 1) { continue }
  $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"')
}
function Need([string]$k) {
  if ([string]::IsNullOrWhiteSpace($cfg[$k])) { throw "Required key '$k' missing/empty in $EnvFile" }
  return $cfg[$k]
}

# ---- Postgres password -------------------------------------------------------
# Postgres only honours POSTGRES_PASSWORD on first initdb (the data volume is
# durable), so silently minting a new one on a re-run would desync DATABASE-URL
# from the live DB and break all connectivity. Require an explicit choice.
if (-not $PostgresPassword) {
  if (-not $RotatePostgresPassword) {
    throw @'
POSTGRES-PASSWORD was not supplied. Choose one:
  -PostgresPassword <existing>   reuse the current DB password (safe; recommended after first bootstrap)
  -RotatePostgresPassword        generate a NEW password (ONLY safe before the Postgres volume is initialized;
                                 rotating after the DB exists breaks connectivity since Postgres keeps its original).
'@
  }
  $bytes = New-Object 'System.Byte[]' 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $PostgresPassword = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
  Write-Host "Generated a new Postgres password (rotation requested)."
}
$databaseUrl = "postgresql://liftoff:$PostgresPassword@${PostgresAppName}:5432/liftoff"

# ---- Build ARM secure-parameter file (never printed) -------------------------
$params = [ordered]@{
  keyVaultName        = @{ value = $KeyVaultName }
  postgresPassword    = @{ value = $PostgresPassword }
  databaseUrl         = @{ value = $databaseUrl }
  jwtSecret           = @{ value = (Need 'JWT_SECRET') }
  jwtRefreshSecret    = @{ value = (Need 'JWT_REFRESH_SECRET') }
  githubClientId      = @{ value = (Need 'GITHUB_CLIENT_ID') }
  githubClientSecret  = @{ value = (Need 'GITHUB_CLIENT_SECRET') }
  githubWebhookSecret = @{ value = (Need 'GITHUB_WEBHOOK_SECRET') }
  doApiToken          = @{ value = (Need 'DO_API_TOKEN') }
  doSpacesAccessKey   = @{ value = (Need 'DO_SPACES_ACCESS_KEY') }
  doSpacesSecretKey   = @{ value = (Need 'DO_SPACES_SECRET_KEY') }
  pulumiPassphrase    = @{ value = (Need 'PULUMI_PASSPHRASE') }
  encryptionKey       = @{ value = (Need 'ENCRYPTION_KEY') }
}
$arm = [ordered]@{
  '$schema'      = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
  contentVersion = '1.0.0.0'
  parameters     = $params
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("liftoff-kv-" + [System.Guid]::NewGuid().ToString('N') + '.json')
try {
  [System.IO.File]::WriteAllText($tmp, ($arm | ConvertTo-Json -Depth 6))
  az deployment group create -g $ResourceGroup -n liftoff-secrets --template-file $SecretsTemplate --parameters "@$tmp" --output none
  if ($LASTEXITCODE -ne 0) { throw "Secret deployment failed." }
}
finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host "All secrets written to vault '$KeyVaultName' (control-plane)."
