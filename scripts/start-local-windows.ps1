$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"

if (-not (Test-Path (Join-Path $RepoRoot ".env.local"))) {
  throw ".env.local이 없습니다. 먼저 scripts\setup-local-windows.ps1을 실행해 주세요."
}

$WhisperServer = Get-ChildItem $WhisperDir -Recurse -Filter "whisper-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $WhisperServer) { throw "whisper-server.exe를 찾지 못했습니다. 설치 스크립트를 다시 실행해 주세요." }

$Model = Get-ChildItem $ModelsDir -Filter "ggml-*.bin" -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
if (-not $Model) { throw "Whisper 모델을 찾지 못했습니다. 설치 스크립트를 다시 실행해 주세요." }

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  throw "Ollama가 설치되어 있지 않습니다."
}

$whisperAlreadyRunning = $false
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 2
  if ($h.status -eq "ok") { $whisperAlreadyRunning = $true }
} catch {}

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

  Write-Host "Whisper 서버 시작 중..." -ForegroundColor Cyan
  $whisperProc = Start-Process -FilePath $WhisperServer.FullName `
    -ArgumentList ($whisperArgs -join " ") `
    -WorkingDirectory $WhisperServer.DirectoryName `
    -PassThru

  $ready = $false
  for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 2
      if ($h.status -eq "ok") { $ready = $true; break }
    } catch {}
    if ($whisperProc.HasExited) { break }
  }
  if (-not $ready) {
    if ($whisperProc -and -not $whisperProc.HasExited) { Stop-Process -Id $whisperProc.Id -Force }
    throw "Whisper 서버가 준비되지 않았습니다."
  }
}

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
} catch {
  throw "Ollama API에 연결할 수 없습니다. Windows 시작 메뉴에서 Ollama를 실행해 주세요."
}

Write-Host "ADE 무료 로컬 모드 시작: http://localhost:3000" -ForegroundColor Green
Start-Process "http://localhost:3000"

Push-Location $RepoRoot
try {
  npm start
} finally {
  Pop-Location
  if ($whisperProc -and -not $whisperProc.HasExited) {
    Stop-Process -Id $whisperProc.Id -Force
  }
}
