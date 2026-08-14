param(
  [string]$Python = "python",
  [switch]$DownloadModel,
  [string]$ModelRepo = "Systran/faster-whisper-large-v3",
  [string]$ModelFolder = "faster-whisper-large-v3"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SourceDir = Join-Path $RepoRoot "desktop\transcriber"
$BuildRoot = Join-Path $RepoRoot ".build\transcriber"
$Venv = Join-Path $BuildRoot "venv"
$RuntimeDir = Join-Path $RepoRoot "runtime\transcriber"
$ModelDir = Join-Path $RepoRoot "runtime\models\$ModelFolder"

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  & $Python -m venv $Venv
}

$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip wheel setuptools
& $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $SourceDir "requirements-build.txt")

Push-Location $SourceDir
try {
  & $VenvPython -m PyInstaller --noconfirm --clean (Join-Path $SourceDir "ade-transcriber.spec") `
    --distpath (Join-Path $BuildRoot "dist") `
    --workpath (Join-Path $BuildRoot "work")
} finally {
  Pop-Location
}

if (Test-Path $RuntimeDir) { Remove-Item $RuntimeDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Copy-Item (Join-Path $BuildRoot "dist\ade-transcriber\*") $RuntimeDir -Recurse -Force

$Exe = Join-Path $RuntimeDir "ade-transcriber.exe"
if (-not (Test-Path $Exe)) { throw "ade-transcriber.exe was not created." }
& $Exe --self-test
if ($LASTEXITCODE -ne 0) { throw "The packaged transcriber self-test failed." }

if ($DownloadModel) {
  New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null
  & $VenvPython (Join-Path $SourceDir "download_model.py") --repo $ModelRepo --output $ModelDir
}

$Manifest = @{
  engine = "faster-whisper"
  executable = "ade-transcriber.exe"
  model_folder = $ModelFolder
  built_at = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 4
$Manifest | Set-Content -Path (Join-Path $RuntimeDir "manifest.json") -Encoding UTF8

Write-Host "ADE transcriber runtime prepared at $RuntimeDir" -ForegroundColor Green
if ($DownloadModel) {
  Write-Host "ADE model pack prepared at $ModelDir" -ForegroundColor Green
}
