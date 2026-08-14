param(
  [string]$Python = "python",
  [string]$ModelRepo = "Systran/faster-whisper-large-v3",
  [string]$ModelFolder = "faster-whisper-large-v3"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SourceDir = Join-Path $RepoRoot "desktop\transcriber"
$BuildRoot = Join-Path $RepoRoot ".build\model-pack"
$Venv = Join-Path $BuildRoot "venv"
$Output = Join-Path $RepoRoot "runtime\models\$ModelFolder"

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  & $Python -m venv $Venv
}
$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip
& $VenvPython -m pip install --disable-pip-version-check "huggingface-hub>=0.34,<2"

New-Item -ItemType Directory -Force -Path $Output | Out-Null
& $VenvPython (Join-Path $SourceDir "download_model.py") --repo $ModelRepo --output $Output
Write-Host "Model pack ready: $Output" -ForegroundColor Green
