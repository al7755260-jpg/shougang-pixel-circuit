param([switch]$PV)
$ErrorActionPreference = 'Stop'
function Open-RacingGame([string]$url) {
  $pvBrowser = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if ($PV -and (Test-Path -LiteralPath $pvBrowser)) {
    $pvProfile = Join-Path $env:LOCALAPPDATA 'ShougangPixelCircuit\PVChrome'
    Start-Process -FilePath $pvBrowser -ArgumentList @('--force-high-performance-gpu', '--use-angle=d3d11', '--no-first-run', ('--user-data-dir="{0}"' -f $pvProfile), ('--app={0}' -f $url)) -WindowStyle Normal
  } else { Start-Process $url }
}
$gameRoot = $PSScriptRoot
$gameRulesVersion = 'public-preview-v' + (Get-Content -LiteralPath (Join-Path $gameRoot 'package.json') -Raw | ConvertFrom-Json).version
$gamePort = 4195
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath -and (Test-Path -LiteralPath 'D:\Software\nodejs\node.exe')) { $nodePath = 'D:\Software\nodejs\node.exe' }
if (-not $nodePath) { throw '需要 Node.js 20.19 或更新版本，请安装 Node.js 后再次启动。' }
if (-not (Test-Path -LiteralPath (Join-Path $gameRoot 'dist\index.html'))) { throw '未找到构建文件。请在当前目录执行 npm install 和 npm run build。' }
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $gameUrl = "http://127.0.0.1:$gamePort/"
  try {
    $reply = Invoke-WebRequest -Uri $gameUrl -TimeoutSec 1 -UseBasicParsing
    if ($reply.Content -match '首钢园 · 像素大奖赛') {
      $gameHealth = $null
      try { $gameHealth = Invoke-RestMethod -Uri ($gameUrl + 'api/health') -TimeoutSec 1 } catch {}
      if ($gameHealth.rulesVersion -eq $gameRulesVersion) { Open-RacingGame $gameUrl; exit }
    }
    $gamePort++
  } catch { break }
}
$gameServer = Join-Path $gameRoot 'server.mjs'
Start-Process -FilePath $nodePath -ArgumentList ('"{0}" {1}' -f $gameServer, $gamePort) -WorkingDirectory $gameRoot -WindowStyle Hidden
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try { $null = Invoke-WebRequest -Uri $gameUrl -TimeoutSec 1 -UseBasicParsing; Open-RacingGame $gameUrl; exit } catch { Start-Sleep -Milliseconds 200 }
}
throw "游戏服务未启动，请在当前目录运行 node server.mjs $gamePort 查看原因。"

