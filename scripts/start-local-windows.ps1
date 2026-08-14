$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"
$EnvLocal = Join-Path $RepoRoot ".env.local"

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

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
} catch {
  throw "Cannot connect to Ollama API. Start Ollama and try again."
}

Write-Host "Direct Whisper CLI mode enabled" -ForegroundColor Cyan
Write-Host "Whisper model: $($Model.Name)" -ForegroundColor Green
Write-Host "ADE local mode: http://localhost:3000" -ForegroundColor Green
Start-Process "http://localhost:3000"

Push-Location $RepoRoot
try {
  & npm.cmd start
} finally {
  Pop-Location
}
