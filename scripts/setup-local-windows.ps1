param(
  [string]$OllamaModel = "qwen3:8b",
  [ValidateSet("tiny","base","small","medium","large-v3-turbo")]
  [string]$WhisperModel = "small"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"
$ZipPath = Join-Path $ToolsDir "whisper-win.zip"
$ModelPath = Join-Path $ModelsDir "ggml-$WhisperModel.bin"

New-Item -ItemType Directory -Force -Path $ToolsDir,$WhisperDir,$ModelsDir | Out-Null

Write-Host ""
Write-Host "=== ADE 무료 로컬 모드 설치 ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js가 없습니다. Node.js 22 이상을 먼저 설치해 주세요."
}
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 이상이 필요합니다. 현재 버전: $(node -v)"
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Ollama가 설치되어 있지 않습니다." -ForegroundColor Yellow
  Write-Host "PowerShell에서 아래 공식 설치 명령을 먼저 실행한 뒤 이 스크립트를 다시 실행해 주세요:"
  Write-Host "  irm https://ollama.com/install.ps1 | iex" -ForegroundColor Green
  exit 2
}

Write-Host "[1/3] Ollama 모델 준비: $OllamaModel"
ollama pull $OllamaModel
if ($LASTEXITCODE -ne 0) { throw "Ollama 모델 다운로드에 실패했습니다." }

$WhisperServer = Get-ChildItem $WhisperDir -Recurse -Filter "whisper-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $WhisperServer) {
  Write-Host "[2/3] whisper.cpp Windows 최신 바이너리 다운로드"
  $release = Invoke-RestMethod -Headers @{ "User-Agent" = "ADE-local-setup" } -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
  if (-not $asset) { throw "whisper.cpp Windows x64 바이너리를 찾지 못했습니다." }
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $ZipPath
  if (Test-Path $WhisperDir) { Remove-Item $WhisperDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $WhisperDir | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $WhisperDir -Force
  Remove-Item $ZipPath -Force
} else {
  Write-Host "[2/3] whisper.cpp 바이너리 이미 설치됨"
}

if (-not (Test-Path $ModelPath)) {
  Write-Host "[3/3] Whisper 다국어 모델 다운로드: $WhisperModel"
  $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WhisperModel.bin?download=true"
  Invoke-WebRequest -Uri $modelUrl -OutFile $ModelPath
} else {
  Write-Host "[3/3] Whisper 모델 이미 설치됨: $WhisperModel"
}

$envPath = Join-Path $RepoRoot ".env.local"
@"
DEFAULT_PROVIDER=local
WHISPER_CPP_URL=http://127.0.0.1:8080
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=$OllamaModel
PORT=3000
MAX_UPLOAD_MB=100
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host ""
Write-Host "설치 완료." -ForegroundColor Green
Write-Host "다음 명령으로 ADE 무료 로컬 모드를 실행하세요:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\start-local-windows.ps1" -ForegroundColor Green
