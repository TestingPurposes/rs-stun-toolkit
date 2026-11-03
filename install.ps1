# install.ps1 <path\to\rs-sdk> [--dry-run] [--no-bun-install] [--force]: wrapper around install.ts (needs bun: https://bun.sh)
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Write-Error "bun is required: https://bun.sh"; exit 2 }
& bun (Join-Path $PSScriptRoot 'install.ts') @args
exit $LASTEXITCODE
