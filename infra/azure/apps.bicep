// =============================================================================
// Liftoff platform — application services (API + web + website)
// =============================================================================
// Deployed at bootstrap and re-runnable for config changes. The CI pipeline
// builds new images and rolls them out with `az containerapp update --image`,
// so day-to-day deploys only swap the image tag; this file remains the single
// source of truth for each app's full configuration.
//
// All runtime secrets are pulled from Key Vault via the user-assigned managed
// identity — nothing sensitive is templated here or stored in CI.
// =============================================================================

param location string = resourceGroup().location
param namePrefix string = 'liftoff'

@description('Resource ID of the Container Apps managed environment.')
param managedEnvironmentId string

@description('ACR login server, e.g. liftoffacr0413.azurecr.io')
param acrLoginServer string

@description('Resource ID of the runtime managed identity (image pull + Key Vault).')
param appIdentityResourceId string

@description('Key Vault URI, e.g. https://liftoff-kv-0413.vault.azure.net/')
param keyVaultUri string

@description('Container Apps environment default domain (for building public URLs).')
param defaultDomain string

@description('Full image reference for the API.')
param apiImage string

@description('Full image reference for the web dashboard.')
param webImage string

@description('Full image reference for the marketing website.')
param websiteImage string

@description('Deploy the marketing website app.')
param deployWebsite bool = true

// ---- Non-secret runtime config (sensible defaults; override at deploy) -------
param doSpacesBucket string
param doSpacesEndpoint string
param doSpacesRegion string
param jwtExpiresIn string = '15m'
param jwtRefreshExpiresIn string = '7d'
param throttleTtl string = '60000'
param throttleLimit string = '100'

// ---- Derived values ----------------------------------------------------------
var apiName = '${namePrefix}-api'
var webName = '${namePrefix}-web'
var websiteName = '${namePrefix}-website'

var apiPublicUrl = 'https://${apiName}.${defaultDomain}'
var webPublicUrl = 'https://${webName}.${defaultDomain}'

var databaseUrl = '${keyVaultUri}secrets/DATABASE-URL'
var redisUrl = 'redis://${namePrefix}-redis:6379'

var registries = [
  {
    server: acrLoginServer
    identity: appIdentityResourceId
  }
]

var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${appIdentityResourceId}': {}
  }
}

// Helper to build a Key Vault-backed secret entry.
var apiSecrets = [
  { name: 'database-url', keyVaultUrl: databaseUrl, identity: appIdentityResourceId }
  { name: 'jwt-secret', keyVaultUrl: '${keyVaultUri}secrets/JWT-SECRET', identity: appIdentityResourceId }
  { name: 'jwt-refresh-secret', keyVaultUrl: '${keyVaultUri}secrets/JWT-REFRESH-SECRET', identity: appIdentityResourceId }
  { name: 'github-client-id', keyVaultUrl: '${keyVaultUri}secrets/GITHUB-CLIENT-ID', identity: appIdentityResourceId }
  { name: 'github-client-secret', keyVaultUrl: '${keyVaultUri}secrets/GITHUB-CLIENT-SECRET', identity: appIdentityResourceId }
  { name: 'github-webhook-secret', keyVaultUrl: '${keyVaultUri}secrets/GITHUB-WEBHOOK-SECRET', identity: appIdentityResourceId }
  { name: 'do-api-token', keyVaultUrl: '${keyVaultUri}secrets/DO-API-TOKEN', identity: appIdentityResourceId }
  { name: 'do-spaces-access-key', keyVaultUrl: '${keyVaultUri}secrets/DO-SPACES-ACCESS-KEY', identity: appIdentityResourceId }
  { name: 'do-spaces-secret-key', keyVaultUrl: '${keyVaultUri}secrets/DO-SPACES-SECRET-KEY', identity: appIdentityResourceId }
  { name: 'pulumi-passphrase', keyVaultUrl: '${keyVaultUri}secrets/PULUMI-PASSPHRASE', identity: appIdentityResourceId }
  { name: 'encryption-key', keyVaultUrl: '${keyVaultUri}secrets/ENCRYPTION-KEY', identity: appIdentityResourceId }
]

// =============================================================================
// API (NestJS) — runs DB migrations on start, then serves REST + WebSockets +
// in-process BullMQ workers. Must stay warm (minReplicas: 1).
// =============================================================================
resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiName
  location: location
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          command: ['/bin/sh', '-c', 'npx prisma migrate deploy && node dist/main.js']
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '4000' }
            { name: 'FRONTEND_URL', value: webPublicUrl }
            { name: 'WEBHOOK_BASE_URL', value: apiPublicUrl }
            // The GitHub OAuth routes are @Version(VERSION_NEUTRAL) under the global
            // 'api' prefix, so the real callback path is /api/auth/... (no /v1/).
            { name: 'GITHUB_CALLBACK_URL', value: '${apiPublicUrl}/api/auth/github/callback' }
            { name: 'REDIS_URL', value: redisUrl }
            { name: 'DO_SPACES_BUCKET', value: doSpacesBucket }
            { name: 'DO_SPACES_ENDPOINT', value: doSpacesEndpoint }
            { name: 'DO_SPACES_REGION', value: doSpacesRegion }
            { name: 'JWT_EXPIRES_IN', value: jwtExpiresIn }
            { name: 'JWT_REFRESH_EXPIRES_IN', value: jwtRefreshExpiresIn }
            { name: 'THROTTLE_TTL', value: throttleTtl }
            { name: 'THROTTLE_LIMIT', value: throttleLimit }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'JWT_REFRESH_SECRET', secretRef: 'jwt-refresh-secret' }
            { name: 'GITHUB_CLIENT_ID', secretRef: 'github-client-id' }
            { name: 'GITHUB_CLIENT_SECRET', secretRef: 'github-client-secret' }
            { name: 'GITHUB_WEBHOOK_SECRET', secretRef: 'github-webhook-secret' }
            { name: 'DO_API_TOKEN', secretRef: 'do-api-token' }
            { name: 'DO_SPACES_ACCESS_KEY', secretRef: 'do-spaces-access-key' }
            { name: 'DO_SPACES_SECRET_KEY', secretRef: 'do-spaces-secret-key' }
            { name: 'PULUMI_PASSPHRASE', secretRef: 'pulumi-passphrase' }
            { name: 'ENCRYPTION_KEY', secretRef: 'encryption-key' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 4000 }
              initialDelaySeconds: 15
              periodSeconds: 10
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 4000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 4000 }
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

// =============================================================================
// Web dashboard (Next.js)
// =============================================================================
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webName
  location: location
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

// =============================================================================
// Marketing website (Next.js standalone) — scales to zero when idle.
// =============================================================================
resource website 'Microsoft.App/containerApps@2024-03-01' = if (deployWebsite) {
  name: websiteName
  location: location
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
    }
    template: {
      containers: [
        {
          name: 'website'
          image: websiteImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output apiFqdn string = api.properties.configuration.ingress.fqdn
output webFqdn string = web.properties.configuration.ingress.fqdn
output websiteFqdn string = deployWebsite ? website.properties.configuration.ingress.fqdn : ''
output apiUrl string = apiPublicUrl
output webUrl string = webPublicUrl
