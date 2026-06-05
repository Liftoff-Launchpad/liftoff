// =============================================================================
// Liftoff platform — data services (Postgres + Redis as Container Apps)
// =============================================================================
// Deployed once at bootstrap; the CI pipeline does NOT touch these (so code
// deploys never restart the database). Both run as single, non-scaling replicas
// with internal TCP ingress, reachable from other apps in the environment at
// `<app-name>:<port>`.
//
// Postgres data is persisted on an Azure Files share mounted with uid/gid=70 so
// the alpine `postgres` user owns the data directory (otherwise initdb fails the
// SMB ownership check). Redis is intentionally ephemeral (queues / pub-sub only).
// =============================================================================

param location string = resourceGroup().location
param namePrefix string = 'liftoff'

@description('Resource ID of the Container Apps managed environment.')
param managedEnvironmentId string

@description('Resource ID of the runtime managed identity (for Key Vault access).')
param appIdentityResourceId string

@description('Key Vault URI, e.g. https://liftoff-kv-0413.vault.azure.net/')
param keyVaultUri string

@description('Named environment storage backing the Postgres data directory.')
param envStorageName string = 'pgdata'

resource postgres 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-postgres'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: 5432
        exposedPort: 5432
      }
      secrets: [
        {
          name: 'postgres-password'
          keyVaultUrl: '${keyVaultUri}secrets/POSTGRES-PASSWORD'
          identity: appIdentityResourceId
        }
      ]
    }
    template: {
      volumes: [
        {
          name: 'pgdata'
          storageType: 'AzureFile'
          storageName: envStorageName
          mountOptions: 'uid=70,gid=70,dir_mode=0700,file_mode=0700,mfsymlinks,cache=strict,nobrl'
        }
      ]
      containers: [
        {
          name: 'postgres'
          image: 'postgres:15-alpine'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'POSTGRES_DB', value: 'liftoff' }
            { name: 'POSTGRES_USER', value: 'liftoff' }
            { name: 'POSTGRES_PASSWORD', secretRef: 'postgres-password' }
            // Subdirectory of the mount avoids putting PGDATA at the share root.
            { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' }
          ]
          volumeMounts: [
            { volumeName: 'pgdata', mountPath: '/var/lib/postgresql/data' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource redis 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-redis'
  location: location
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: 6379
        exposedPort: 6379
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'redis:7-alpine'
          command: ['redis-server', '--appendonly', 'no', '--save', '']
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output postgresAppName string = postgres.name
output redisAppName string = redis.name
output databaseHost string = '${postgres.name}:5432'
output redisHost string = '${redis.name}:6379'
