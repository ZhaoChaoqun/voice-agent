<#
.SYNOPSIS
Run the Conference Concierge Template end to end on this machine: the conference MCP pack,
a Dev Tunnel that lets Foundry reach it, and the local Playground build that binds the
Template to that tunnel.

.DESCRIPTION
Foundry calls MCP servers from the cloud, so a localhost MCP needs a public HTTPS URL.
This script reuses (or creates) a persistent anonymous Dev Tunnel for -McpPort, stages a
fresh Playground build context, writes an untracked profile that points only the
conference Template at the tunnel, and starts demo_server.py on -PortalPort.
Other Templates keep using the shared no-auth MCP. Nothing is deployed to Azure.

Logs go to portal/.run/ (git-ignored). Stop with Ctrl+C, or
when started with -Background, stop the PIDs printed at the end.

.EXAMPLE
.\run_local.ps1 -ProjectEndpoint https://<account>.services.ai.azure.com/api/projects/<project>
#>
param(
    [string]$ProjectEndpoint = $env:AZURE_VOICE_AGENTS_ENDPOINT,
    [int]$McpPort = 18787,
    [int]$PortalPort = 9531,
    [string]$TunnelId = "conference-concierge-mcp",
    [string]$Python = "",
    [double]$LiveRefreshMinutes = 30,
    # Use the hosted no-auth MCP route instead of a local pack and Dev Tunnel.
    [switch]$HostedMcp,
    [switch]$Background
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $Python) { $Python = Join-Path $repo ".venv\Scripts\python.exe" }
if (-not (Test-Path $Python)) {
    throw "Python not found at $Python. Create it: python -m venv .venv; .venv\Scripts\python.exe -m pip install -r portal\requirements.txt -r shared_mcp\requirements.txt"
}
if (-not $ProjectEndpoint) { throw "Pass -ProjectEndpoint (a Foundry Project where you can create Voice Agents) or set AZURE_VOICE_AGENTS_ENDPOINT." }
foreach ($port in @($PortalPort) + @(if (-not $HostedMcp) { $McpPort })) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Pick another with -McpPort / -PortalPort; do not stop someone else's service."
    }
}
$run = Join-Path $repo "portal\.run"
New-Item -ItemType Directory -Force $run | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
if ($HostedMcp) {
    $portalArgs = @(
        "-u", (Join-Path $repo "portal\demo_server.py"),
        "--bind", "127.0.0.1", "--port", "$PortalPort",
        "--project-endpoint", $ProjectEndpoint,
        "--credential-mode", "cli",
        "--data-dir", (Join-Path $run "portal-data")
    )
    Write-Host "MCP            : hosted, from portal/templates.config.json"
    Write-Host "Playground     : http://127.0.0.1:$PortalPort/editor/"
    if ($Background) {
        $portal = Start-Process -FilePath $Python -ArgumentList $portalArgs -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput "$run\playground-$stamp.log" -RedirectStandardError "$run\playground-$stamp.err.log"
        Write-Host "Started in the background (PID $($portal.Id); the listener on port $PortalPort may be its child)."
    } else {
        & $Python @portalArgs
    }
    return
}
$devtunnel = (Get-Command devtunnel -ErrorAction SilentlyContinue).Source
if (-not $devtunnel) {
    $devtunnel = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet" -Recurse -Filter devtunnel.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $devtunnel) { throw "Install the Dev Tunnels CLI (winget install Microsoft.devtunnel) and run 'devtunnel user login'." }


# 1. Conference MCP pack, no auth, stateless, on loopback.
$mcp = Start-Process -FilePath $Python -WorkingDirectory (Join-Path $repo "shared_mcp\app") -PassThru -WindowStyle Hidden `
    -ArgumentList "-m", "shared_mcp.conference", "--port", "$McpPort", "--allowed-host", "*", "--live-refresh-minutes", "$LiveRefreshMinutes" `
    -RedirectStandardOutput "$run\conference-mcp-$stamp.log" -RedirectStandardError "$run\conference-mcp-$stamp.err.log"
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod "http://127.0.0.1:$McpPort/healthz" -TimeoutSec 2 } catch { $health = $null }
} until ($health -or (Get-Date) -gt $deadline)
if (-not $health) { throw "The conference MCP did not start; see $run\conference-mcp-$stamp.err.log" }

# 2. Persistent anonymous Dev Tunnel for the MCP port (the URL stays the same across restarts).
& $devtunnel show $TunnelId *> $null
if ($LASTEXITCODE -ne 0) {
    & $devtunnel create $TunnelId --allow-anonymous --expiration 30d | Out-Null
    & $devtunnel port create $TunnelId -p $McpPort --protocol http | Out-Null
}
$tunnelLog = "$run\devtunnel-$stamp.log"
$tunnel = Start-Process -FilePath $devtunnel -ArgumentList "host", $TunnelId -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $tunnelLog -RedirectStandardError "$tunnelLog.err"
$public = $null
$deadline = (Get-Date).AddSeconds(60)
do {
    Start-Sleep -Seconds 1
    $line = Select-String -Path $tunnelLog -Pattern "Connect via browser: (https://\S+)" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) { $public = $line.Matches[0].Groups[1].Value.TrimEnd("/") }
} until ($public -or (Get-Date) -gt $deadline)
if (-not $public) { throw "Dev Tunnel did not start; see $tunnelLog" }
$probe = Invoke-WebRequest "$public/healthz" -TimeoutSec 30 -UseBasicParsing
if ($probe.StatusCode -ne 200) { throw "The tunnel did not reach the MCP: HTTP $($probe.StatusCode)" }

# 3. An untracked copy of the Template catalog in portal/.run/ that points only this Template at the tunnel.
$catalogDir = Join-Path $repo "portal\.run"
New-Item -ItemType Directory -Force $catalogDir | Out-Null
$catalogPath = Join-Path $catalogDir "templates.conference-local.json"
$catalog = Get-Content (Join-Path $repo "portal\templates.config.json") -Raw | ConvertFrom-Json
foreach ($entry in $catalog.templates) {
    # Folders are relative to the catalog file, which now sits one level deeper.
    $entry.folder = "../" + $entry.folder
    if ($entry.id -eq "conference-concierge-example") {
        $entry.mcp.server_url = "$public/mcp/conference"
        $entry.mcp.source_label = "Local conference MCP via Dev Tunnel"
    }
}
$catalog | ConvertTo-Json -Depth 20 | Set-Content -Path $catalogPath -Encoding utf8

# 4. Local Portal (Foundry calls use your az login identity).
$portalArgs = @(
    "-u", (Join-Path $repo "portal\demo_server.py"),
    "--bind", "127.0.0.1", "--port", "$PortalPort",
    "--project-endpoint", $ProjectEndpoint,
    "--credential-mode", "cli",
    "--template-config", $catalogPath,
    "--data-dir", (Join-Path $run "portal-data")
)
Write-Host "Conference MCP : http://127.0.0.1:$McpPort/mcp/conference (PID $($mcp.Id))"
Write-Host "Dev Tunnel     : $public/mcp/conference (PID $($tunnel.Id))"
Write-Host "Playground     : http://127.0.0.1:$PortalPort/editor/"
function Stop-Started([int[]]$ProcessIds, [int[]]$Ports) {
    # A venv python.exe is a launcher; the listening interpreter is its child, found by port.
    $listeners = $Ports | ForEach-Object {
        (Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue).OwningProcess
    }
    Stop-Process -Id (@($listeners) + $ProcessIds | Where-Object { $_ } | Select-Object -Unique) -ErrorAction SilentlyContinue
}
if ($Background) {
    $portal = Start-Process -FilePath $Python -ArgumentList $portalArgs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$run\playground-$stamp.log" -RedirectStandardError "$run\playground-$stamp.err.log"
    Write-Host "Started in the background. Logs: $run\*-$stamp.*"
    Write-Host "Stop with: Stop-Process -Id <listener PIDs of ports $PortalPort and $McpPort>,$($portal.Id),$($tunnel.Id),$($mcp.Id)"
} else {
    try { & $Python @portalArgs } finally { Stop-Started @($tunnel.Id, $mcp.Id) @($McpPort) }
}
