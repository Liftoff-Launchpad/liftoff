// =============================================================================
// Liftoff platform — core Azure infrastructure (run once at bootstrap)
// =============================================================================
// Provisions the shared, stable resources the platform runs on:
//   - Log Analytics workspace + Container Apps managed environment
//   - Azure Container Registry (image store)
//   - Azure Key Vault (RBAC) holding every runtime secret
//   - TWO user-assigned managed identities (least privilege):
//       * liftoff-cicd-mi  — GitHub Actions OIDC identity. AcrPush + RG Contributor
//         (build/push images, roll out container apps). Never attached to an app.
//       * liftoff-app-mi   — runtime identity attached to every container app.
//         AcrPull + Key Vault Secrets User ONLY, so a compromised app process
//         cannot escalate to control-plane writes or read CI's deploy rights.
//     The federated credential lets CI authenticate WITHOUT an Entra app
//     registration (blocked on this tenant) and WITHOUT any secret in GitHub.
//   - A Storage account + file share that backs the Postgres container's data.
//
// Scope: resource group.
// =============================================================================

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Name prefix for all resources.')
param namePrefix string = 'liftoff'

@description('Globally-unique suffix for ACR / Key Vault / Storage names.')
param suffix string = '0413'

@description('GitHub repository (owner/name) trusted for OIDC federation.')
param githubRepo string = 'munimx/liftoff'

@description('Git branch allowed to deploy via the federated credential.')
param githubBranch string = 'main'

@description('Enable Key Vault purge protection (IRREVERSIBLE once on).')
param enableKvPurgeProtection bool = false

@description('Key Vault soft-delete retention in days. Cannot be changed after the vault exists (pass the existing value when redeploying).')
param kvSoftDeleteRetentionInDays int = 90

// ---- Built-in role definition IDs -------------------------------------------
var roleAcrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var roleAcrPush = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
var roleKvSecretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var roleContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')

var acrName = '${namePrefix}acr${suffix}'
var kvName = '${namePrefix}-kv-${suffix}'
var storageName = '${namePrefix}stor${suffix}'

// ---- CI/CD identity (GitHub Actions, via OIDC) ------------------------------
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-cicd-mi'
  location: location
}

// GitHub Actions OIDC federation. The subject must match the workflow's token
// claim exactly. The deploy job runs in `environment: production`, so its token
// subject is `repo:<repo>:environment:production`; the branch credential covers
// runs that don't set an environment. No client secret is ever created.
resource fedCredMain 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: uami
  name: 'github-${githubBranch}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:ref:refs/heads/${githubBranch}'
    audiences: ['api://AzureADTokenExchange']
  }
}

// NOTE: federated credentials under one identity cannot be written concurrently,
// so this depends on the branch credential to force ARM to create them in series.
resource fedCredEnv 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: uami
  name: 'github-env-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:environment:production'
    audiences: ['api://AzureADTokenExchange']
  }
  dependsOn: [fedCredMain]
}

// ---- Runtime identity (attached to the container apps) ----------------------
resource appUami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-app-mi'
  location: location
}

// ---- Container registry ------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ---- Key Vault (RBAC authorization, secrets seeded out-of-band) --------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: kvSoftDeleteRetentionInDays
    enablePurgeProtection: enableKvPurgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
  }
}

// ---- Storage account + file share for Postgres data --------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource pgShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  parent: fileService
  name: 'pgdata'
  properties: {
    shareQuota: 8
    enabledProtocols: 'SMB'
  }
}

// ---- Log Analytics + Container Apps environment ------------------------------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// Register the Azure File share as named environment storage so container apps
// can mount it (used by the Postgres app for durable data).
resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: 'pgdata'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: 'pgdata'
      accessMode: 'ReadWrite'
    }
  }
}

// ---- Role assignments --------------------------------------------------------
// Runtime identity: pull images from ACR.
resource raAppAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appUami.id, roleAcrPull)
  scope: acr
  properties: {
    roleDefinitionId: roleAcrPull
    principalId: appUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Runtime identity: read secrets from Key Vault.
resource raAppKvSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, appUami.id, roleKvSecretsUser)
  scope: kv
  properties: {
    roleDefinitionId: roleKvSecretsUser
    principalId: appUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// CI/CD identity: push images to ACR (AcrPush includes pull).
resource raCiAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, roleAcrPush)
  scope: acr
  properties: {
    roleDefinitionId: roleAcrPush
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// CI/CD identity: create/update container apps in this resource group. NOT given
// Key Vault access, so an OIDC-authenticated workflow cannot read app secrets.
resource raCiContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, uami.id, roleContributor)
  properties: {
    roleDefinitionId: roleContributor
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Outputs (consumed by data.bicep / apps.bicep and the CI pipeline) -------
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output managedEnvironmentId string = env.id
output managedEnvironmentName string = env.name
output defaultDomain string = env.properties.defaultDomain
output cicdIdentityClientId string = uami.properties.clientId
output cicdIdentityResourceId string = uami.id
output appIdentityResourceId string = appUami.id
output appIdentityClientId string = appUami.properties.clientId
output appIdentityPrincipalId string = appUami.properties.principalId
output keyVaultName string = kv.name
output keyVaultUri string = kv.properties.vaultUri
output storageAccountName string = storage.name
output envStorageName string = envStorage.name
output tenantId string = subscription().tenantId
output subscriptionId string = subscription().subscriptionId
output resourceGroupName string = resourceGroup().name
output location string = location
