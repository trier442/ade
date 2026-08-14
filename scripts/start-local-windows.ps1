$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"
$LogDir = Join-Path $ToolsDir "logs"
$EnvLocal = Join-Path $RepoRoot ".env.local"
$ProxyScript = Join-Path $RepoRoot "scripts\whisper-proxy.mjs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$ProxyOut = Join-Path $LogDir "whisper-proxy.out.log"
$ProxyErr = Join-Path $LogDir "whisper-proxy.err.log"

if (-not (Test-Path $EnvLocal)) {
  throw ".env.local was not found. Run scripts\setup-local-windows.ps1 first."
}

$WhisperCli = Get-ChildItem $WhisperDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $WhisperCli) {
  throw "whisper-cli.exe was not found. Run the setup script again."
}

$Model = Get-ChildItem $ModelsDir -Filter "ggml-*.bin" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "silero" } | Sort-Object Length -Descending | Select-Object -First 1
if (-not $Model) {
  throw "Whisper model was not found. Run the setup script again."
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  throw "Ollama was not found."
}

function Test-WhisperProxy {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:8080/" -TimeoutSec 2
    return ($r.service -eq "ade-whisper-cli-proxy" -and $r.ok -eq $true)
  } catch {
    return $false
  }
}

# If an old whisper-server still owns port 8080, stop it before starting the proxy.
try {
  $conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn -and -not (Test-WhisperProxy)) {
    $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and ($p.ProcessName -like "whisper*" -or $p.ProcessName -eq "node")) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } else {
      throw "Port 8080 is already used by another application. Close it and try again."
    }
  }
} catch {
  if ($_.Exception.Message -like "Port 8080*") { throw }
}

$proxyAlreadyRunning = Test-WhisperProxy
$proxyProc = $null

if (-not $proxyAlreadyRunning) {
  Remove-Item $ProxyOut,$ProxyErr -Force -ErrorAction SilentlyContinue
  Write-Host "Starting stable Whisper CLI proxy..." -ForegroundColor Cyan
  $proxyProc = Start-Process -FilePath "node.exe" `
    -ArgumentList "`"$ProxyScript`"" `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $ProxyOut `
    -RedirectStandardError $ProxyErr `
    -PassThru

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ($proxyProc.HasExited) { break }
    if (Test-WhisperProxy) { $ready = $true; break }
  }

  if (-not $ready) {
    if ($proxyProc -and -not $proxyProc.HasExited) {
      Stop-Process -Id $proxyProc.Id -Force
    }
    Write-Host "Whisper proxy stderr log:" -ForegroundColor Yellow
    if (Test-Path $ProxyErr) { Get-Content $ProxyErr -Tail 80 }
    throw "Whisper CLI proxy did not become ready. See .local-tools\logs\whisper-proxy.err.log"
  }
}

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
} catch {
  throw "Cannot connect to Ollama API. Start Ollama and try again."
}

Write-Host "Whisper CLI proxy: http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "Whisper model: $($Model.Name)" -ForegroundColor Green
Write-Host "ADE local mode: http://localhost:3000" -ForegroundColor Green
Start-Process "http://localhost:3000"

Push-Location $RepoRoot
try {
  & npm.cmd start
} finally {
  Pop-Location
  if ($proxyProc -and -not $proxyProc.HasExited) {
    Stop-Process -Id $proxyProc.Id -Force
  }
}
