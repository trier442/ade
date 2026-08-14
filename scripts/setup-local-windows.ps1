param(
  [string]$OllamaModel = "qwen3:8b",
  [ValidateSet("tiny","base","small","medium","large-v3-turbo")]
  [string]$WhisperModel = "large-v3-turbo"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $RepoRoot ".local-tools"
$WhisperDir = Join-Path $ToolsDir "whisper"
$ModelsDir = Join-Path $ToolsDir "models"
$ZipPath = Join-Path $ToolsDir "whisper-win.zip"
$ModelPath = Join-Path $ModelsDir "ggml-$WhisperModel.bin"
$VadPath = Join-Path $ModelsDir "ggml-silero-v6.2.0.bin"

New-Item -ItemType Directory -Force -Path $ToolsDir,$WhisperDir,$ModelsDir | Out-Null

Write-Host ""
Write-Host "=== ADE LOCAL SETUP ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22 or newer first."
}

$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Current version: $(node -v)"
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Ollama was not found." -ForegroundColor Yellow
  Write-Host "Install Ollama first, then run this script again."
  Write-Host "  irm https://ollama.com/install.ps1 | iex" -ForegroundColor Green
  exit 2
}

Write-Host "[1/4] Preparing Ollama model: $OllamaModel"
& ollama pull $OllamaModel
if ($LASTEXITCODE -ne 0) {
  throw "Ollama model download failed."
}

$WhisperCli = Get-ChildItem $WhisperDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $WhisperCli) {
  Write-Host "[2/4] Downloading latest whisper.cpp Windows x64 binary"
  $release = Invoke-RestMethod -Headers @{ "User-Agent" = "ADE-local-setup" } -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
  if (-not $asset) {
    throw "Could not find whisper.cpp Windows x64 binary."
  }
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $ZipPath
  if (Test-Path $WhisperDir) {
    Remove-Item $WhisperDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $WhisperDir | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $WhisperDir -Force
  Remove-Item $ZipPath -Force
} else {
  Write-Host "[2/4] whisper.cpp binary already installed"
}

if (-not (Test-Path $ModelPath)) {
  Write-Host "[3/4] Downloading Whisper multilingual model: $WhisperModel"
  $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WhisperModel.bin?download=true"
  Invoke-WebRequest -UseBasicParsing -Uri $modelUrl -OutFile $ModelPath
} else {
  Write-Host "[3/4] Whisper model already installed: $WhisperModel"
}

if (-not (Test-Path $VadPath)) {
  Write-Host "[4/4] Downloading Silero VAD model"
  $vadUrl = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin?download=true"
  Invoke-WebRequest -UseBasicParsing -Uri $vadUrl -OutFile $VadPath
} else {
  Write-Host "[4/4] Silero VAD model already installed"
}

$envPath = Join-Path $RepoRoot ".env.local"
@"
DEFAULT_PROVIDER=local
WHISPER_CPP_URL=http://127.0.0.1:8080
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=$OllamaModel
PORT=3000
MAX_UPLOAD_MB=100
"@ | Set-Content -Path $envPath -Encoding ASCII

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Whisper model: $WhisperModel" -ForegroundColor Green
Write-Host "Run ADE local mode with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\start-local-windows.ps1" -ForegroundColor Green
