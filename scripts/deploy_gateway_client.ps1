param(
  [string]$ProjectDir = (Get-Location).Path,
  [string]$Branch = "main",
  [string]$ComposeFile = "docker-compose.gateway.yml",
  [string]$ProdComposeFile = "docker-compose.prod.yml"
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectDir

Write-Host "==> Validando repositorio"
git status --short
git fetch --all --prune
git checkout $Branch
git pull --ff-only origin $Branch

Write-Host "==> Validando .env do gateway"
$requiredVars = @(
  "SAAS_URL",
  "GATEWAY_DEVICE_ID",
  "GATEWAY_DEVICE_TOKEN",
  "TOLETUS_HOST"
)

$envMap = @{}
Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $parts = $_.Split('=', 2)
  $envMap[$parts[0].Trim()] = $parts[1].Trim()
}

$missing = @()
foreach ($key in $requiredVars) {
  if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envMap[$key])) {
    $missing += $key
  }
}

if ($missing.Count -gt 0) {
  throw "Variaveis obrigatorias ausentes no .env: $($missing -join ', ')"
}

Write-Host "==> Derrubando stack completa, se existir"
docker compose -f $ProdComposeFile down

Write-Host "==> Validando compose do gateway"
docker compose -f $ComposeFile config -q

Write-Host "==> Subindo somente gateway-toletus"
docker compose -f $ComposeFile up -d --build gateway-toletus

Write-Host "==> Status"
docker compose -f $ComposeFile ps

Write-Host "==> Logs recentes"
docker compose -f $ComposeFile logs --tail=100 gateway-toletus
