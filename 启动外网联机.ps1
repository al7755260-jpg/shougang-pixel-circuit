$ErrorActionPreference = 'Stop'
$gameShareDir = Join-Path $env:LOCALAPPDATA 'ShougangPixelCircuit'
$gameRulesVersion = 'public-preview-v' + (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
$gameShareInfo = Join-Path $gameShareDir 'share-session.json'
if (Test-Path -LiteralPath $gameShareInfo) {
  try {
    $gameSession = Get-Content -LiteralPath $gameShareInfo -Raw | ConvertFrom-Json
    $gameHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$($gameSession.port)/api/health" -TimeoutSec 2
    if ($gameHealth.rulesVersion -eq $gameRulesVersion -and $gameSession.status -eq 'ready' -and $gameHealth.publicOrigin -eq $gameSession.origin) {
      Start-Process "http://127.0.0.1:$($gameSession.port)/?multiplayer=1"
      exit
    }
  } catch {}
}
$gameToolsDir = Join-Path $gameShareDir 'tools'
New-Item -ItemType Directory -Path $gameToolsDir -Force | Out-Null
$gameTunnelExe = Join-Path $gameToolsDir 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $gameTunnelExe)) {
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile ($gameTunnelExe + '.download')
  Move-Item -LiteralPath ($gameTunnelExe + '.download') -Destination $gameTunnelExe
}
$gameNodePath = (Get-Command node).Source
$gameSharePort = 4197
while (Get-NetTCPConnection -LocalPort $gameSharePort -State Listen -ErrorAction SilentlyContinue) { $gameSharePort++ }
$gameShareScript = Join-Path $PSScriptRoot 'scripts/share-server.mjs'
$gameShareProcess = Start-Process -FilePath $gameNodePath -ArgumentList ('"{0}" {1}' -f $gameShareScript,$gameSharePort) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gameShareDir "share-$gameSharePort.log") -RedirectStandardError (Join-Path $gameShareDir "share-$gameSharePort.err") -PassThru
for ($gameAttempt=0; $gameAttempt -lt 60; $gameAttempt++) {
  Start-Sleep -Seconds 1
  if ($gameShareProcess.HasExited) { throw '外网分享服务未启动，请查看 ShougangPixelCircuit 中的分享日志。' }
  try {
    $gameSession = Get-Content -LiteralPath $gameShareInfo -Raw | ConvertFrom-Json
    if ($gameSession.pid -eq $gameShareProcess.Id -and $gameSession.status -eq 'ready') { Start-Process "http://127.0.0.1:$gameSharePort/?multiplayer=1"; exit }
    if ($gameSession.pid -eq $gameShareProcess.Id -and $gameSession.status -eq 'error') { break }
  } catch {}
}
Start-Process "http://127.0.0.1:$gameSharePort/?multiplayer=1"
Write-Warning '外网入口暂未连通，目前只能分享同一 Wi-Fi 链接。稍后点击刷新房间可更新地址。'
