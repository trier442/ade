$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"
$EnvLocal = Join-Path $RepoRoot ".env.local"

if (-not (Test-Path $EnvLocal)) {
  throw ".env.local was not found. Run scripts\setup-local-windows.ps1 first."
}

$WhisperServer = Get-ChildItem $WhisperDir -Recurse -Filter "whisper-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $WhisperServer) {
  throw "whisper-server.exe was not found. Run the setup script again."
}

$Model = Get-ChildItem $ModelsDir -Filter "ggml-*.bin" -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
if (-not $Model) {
  throw "Whisper model was not found. Run the setup script again."
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  throw "Ollama was not found."
}

function Test-WhisperServer {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/" -TimeoutSec 2 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

$whisperAlreadyRunning = Test-WhisperServer
$whisperProc = $null

if (-not $whisperAlreadyRunning) {
  $whisperArgs = @(
    "-m", "`"$($Model.FullName)`"",
    "--host", "127.0.0.1",
    "--port", "8080",
    "-l", "ko",
    "-nlp"
  )

  if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    $whisperArgs += "--convert"
  }

  Write-Host "Starting Whisper server..." -ForegroundColor Cyan
  $whisperProc = Start-Process -FilePath $WhisperServer.FullName `
    -ArgumentList ($whisperArgs -join " ") `
    -WorkingDirectory $WhisperServer.DirectoryName `
    -PassThru

  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Test-WhisperServer) {
      $ready = $true
      break
    }
    if ($whisperProc.HasExited) {
      break
    }
  }

  if (-not $ready) {
    if ($whisperProc -and -not $whisperProc.HasExited) {
      Stop-Process -Id $whisperProc.Id -Force
    }
    throw "Whisper server did not become ready."
  }
}

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
} catch {
  throw "Cannot connect to Ollama API. Start Ollama and try again."
}

Write-Host "ADE local mode: http://localhost:3000" -ForegroundColor Green
Start-Process "http://localhost:3000"

Push-Location $RepoRoot
try {
  & npm.cmd start
} finally {
  Pop-Location
  if ($whisperProc -and -not $whisperProc.HasExited) {
    Stop-Process -Id $whisperProc.Id -Force
  }
}
