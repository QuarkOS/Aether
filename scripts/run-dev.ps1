# Launch Aether desktop (dev) with local voice venv + ffmpeg.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$venvPython = Join-Path $root "services\voice\.venv\Scripts\python.exe"
$ffmpegBin = Join-Path $root "tools\ffmpeg\bin"

if (-not (Test-Path $venvPython)) {
  throw "Missing voice venv at $venvPython. Run: python -m venv services/voice/.venv && pip install -r services/voice/requirements.txt"
}
if (Test-Path $ffmpegBin) {
  $env:Path = "$ffmpegBin;$env:Path"
}

$env:AETHER_PYTHON = $venvPython
Set-Location $root
npm run dev
