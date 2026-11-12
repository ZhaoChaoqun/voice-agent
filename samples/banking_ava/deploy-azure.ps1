[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Subscription,
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [Parameter(Mandatory = $true)][string]$EnvironmentName,
    [Parameter(Mandatory = $true)][string]$RegistryName,
    [Parameter(Mandatory = $true)][string]$FoundryResourceId,
    [string]$AppName = "ava-banking-demo"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & az @Arguments --subscription $Subscription
    if ($LASTEXITCODE -ne 0) { throw "Azure operation failed: $($Arguments[0]) $($Arguments[1])" }
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $root ".env")) {
    if ($line -match '^\s*([A-Z_]+)=(.*)$') { $settings[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'") }
}
if (-not $settings.AZURE_AI_PROJECT_ENDPOINT -or $settings.DEMO_ACCESS_CODE.Length -lt 16) {
    throw "Configure .env with a Foundry endpoint and a random presenter code of at least 16 characters."
}
if (-not $settings.AZURE_VOICE_AGENT_NAME) { $settings.AZURE_VOICE_AGENT_NAME = "ava-mobile-banking-demo" }
$environment = Invoke-Az containerapp env show -g $ResourceGroup -n $EnvironmentName --output json | ConvertFrom-Json
$registry = Invoke-Az acr show -n $RegistryName --output json | ConvertFrom-Json
if ($registry.resourceGroup -ne $ResourceGroup) { throw "This sample expects the existing registry and environment in the selected resource group." }
$existing = Invoke-Az containerapp list -g $ResourceGroup --output json | ConvertFrom-Json
$target = $existing | Where-Object name -eq $AppName
if ($target -and $target.tags.sample -ne "banking_ava") { throw "App name belongs to another deployment. Choose a new AppName." }
$tag = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
$image = "$($registry.loginServer)/banking-ava:$tag"
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "ava-build-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path "$stage\samples\banking_ava\public", "$stage\samples\foundry_voice_webrtc" -Force | Out-Null
try {
    # An explicit allowlist keeps .env, source history, recordings and unrelated samples out of ACR.
    foreach ($name in @("Dockerfile", "requirements.txt", "server.py", "banking.py")) {
        Copy-Item -LiteralPath (Join-Path $root $name) -Destination "$stage\samples\banking_ava\$name"
    }
    foreach ($name in @("index.html", "style.css", "app.js", "favicon.svg")) {
        Copy-Item -LiteralPath "$root\public\$name" -Destination "$stage\samples\banking_ava\public\$name"
    }
    Copy-Item -LiteralPath "$root\..\foundry_voice_webrtc\auth.py" -Destination "$stage\samples\foundry_voice_webrtc\auth.py"
    Invoke-Az acr build --registry $RegistryName --image "banking-ava:$tag" --file "samples/banking_ava/Dockerfile" $stage --no-logs --output none
    $values = @{
        appName = $AppName; location = $environment.location; environmentName = $EnvironmentName
        registryName = $RegistryName; image = $image; projectEndpoint = $settings.AZURE_AI_PROJECT_ENDPOINT
        agentName = $settings.AZURE_VOICE_AGENT_NAME; accessCode = $settings.DEMO_ACCESS_CODE
    }
    $parameters = @{ '$schema' = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"; contentVersion = "1.0.0.0"; parameters = @{} }
    foreach ($key in $values.Keys) { $parameters.parameters[$key] = @{ value = $values[$key] } }
    $parameterFile = Join-Path $stage "parameters.json"
    $parameters | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $parameterFile -Encoding utf8
    $deployment = Invoke-Az deployment group create -g $ResourceGroup --name "$AppName-$tag" `
        --template-file "$root\infra\main.bicep" --parameters "@$parameterFile" --output json | ConvertFrom-Json
    $principal = $deployment.properties.outputs.principalId.value
    $roles = Invoke-Az role assignment list --scope $FoundryResourceId --output json | ConvertFrom-Json
    if (-not ($roles | Where-Object { $_.principalId -eq $principal -and $_.roleDefinitionName -eq "Foundry User" })) {
        Invoke-Az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal `
            --role "Foundry User" --scope $FoundryResourceId --output none
    }
    $url = $deployment.properties.outputs.url.value
    $health = Invoke-RestMethod "$url/health"
    if ($health.status -ne "ok") { throw "Deployment health check failed." }
    Write-Host "AVA deployed: $url"
    Write-Host "Use the presenter code in this sample's .env. Allow a few minutes for new Foundry role assignments."
    Write-Host "Run smoke.py --url $url to verify inference and simulated banking actions."
}
finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
