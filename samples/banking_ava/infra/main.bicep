targetScope = 'resourceGroup'

param appName string = 'ava-banking-demo'
param location string
param environmentName string
param registryName string
param image string
param projectEndpoint string
param agentName string = 'ava-mobile-banking-demo'
@secure()
param accessCode string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-pull'
  location: location
  tags: { sample: 'banking_ava' }
}
resource pullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullIdentity.id, 'AcrPull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: { sample: 'banking_ava' }
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: [{ name: 'presenter-code', value: accessCode }]
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: pullIdentity.id }]
    }
    template: {
      containers: [{
        name: 'ava'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'AZURE_AI_PROJECT_ENDPOINT', value: projectEndpoint }
          { name: 'AZURE_VOICE_AGENT_NAME', value: agentName }
          { name: 'PUBLIC_ORIGIN', value: 'https://${appName}.${environment.properties.defaultDomain}' }
          { name: 'DEMO_ACCESS_CODE', secretRef: 'presenter-code' }
        ]
        probes: [
          {
            type: 'Liveness'
            httpGet: { path: '/health', port: 8080 }
            initialDelaySeconds: 10
            periodSeconds: 30
          }
          {
            type: 'Readiness'
            httpGet: { path: '/health', port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 10
          }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [pullRole]
}
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
output principalId string = app.identity.principalId
