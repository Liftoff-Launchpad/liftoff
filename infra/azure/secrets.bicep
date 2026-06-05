// =============================================================================
// Liftoff platform — Key Vault secret seeding (control-plane / ARM)
// =============================================================================
// Creates the runtime secrets as ARM child resources of the vault. This uses the
// deployer's *control-plane* permission (Owner/Contributor), so it works even on
// an RBAC vault where the deployer has no data-plane (Secrets Officer) role.
//
// Values are passed as @secure() parameters at deploy time (sourced from the
// local apps/api/.env + a generated Postgres password). Secure parameters are
// redacted from ARM deployment history.
// =============================================================================

@description('Name of the existing Key Vault.')
param keyVaultName string

@secure()
param postgresPassword string
@secure()
param databaseUrl string
@secure()
param jwtSecret string
@secure()
param jwtRefreshSecret string
@secure()
param githubClientId string
@secure()
param githubClientSecret string
@secure()
param githubWebhookSecret string
@secure()
param doApiToken string
@secure()
param doSpacesAccessKey string
@secure()
param doSpacesSecretKey string
@secure()
param pulumiPassphrase string
@secure()
param encryptionKey string

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource sPostgresPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'POSTGRES-PASSWORD'
  properties: { value: postgresPassword }
}
resource sDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'DATABASE-URL'
  properties: { value: databaseUrl }
}
resource sJwtSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'JWT-SECRET'
  properties: { value: jwtSecret }
}
resource sJwtRefreshSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'JWT-REFRESH-SECRET'
  properties: { value: jwtRefreshSecret }
}
resource sGithubClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'GITHUB-CLIENT-ID'
  properties: { value: githubClientId }
}
resource sGithubClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'GITHUB-CLIENT-SECRET'
  properties: { value: githubClientSecret }
}
resource sGithubWebhookSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'GITHUB-WEBHOOK-SECRET'
  properties: { value: githubWebhookSecret }
}
resource sDoApiToken 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'DO-API-TOKEN'
  properties: { value: doApiToken }
}
resource sDoSpacesAccessKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'DO-SPACES-ACCESS-KEY'
  properties: { value: doSpacesAccessKey }
}
resource sDoSpacesSecretKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'DO-SPACES-SECRET-KEY'
  properties: { value: doSpacesSecretKey }
}
resource sPulumiPassphrase 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'PULUMI-PASSPHRASE'
  properties: { value: pulumiPassphrase }
}
resource sEncryptionKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'ENCRYPTION-KEY'
  properties: { value: encryptionKey }
}
