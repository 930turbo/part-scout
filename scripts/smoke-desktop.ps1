$ErrorActionPreference = 'Stop'
$taskDesktopPath = (Resolve-Path (Join-Path $PSScriptRoot '../release/Part-Scout-2.0.0-Windows-x64.exe')).Path
$taskSmokeDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('part-scout-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskSmokeDirectory | Out-Null
$env:SCOUT_SMOKE_TEST = '1'
$env:SCOUT_DESKTOP_DATA_DIR = $taskSmokeDirectory
$env:ELECTRON_RUN_AS_NODE = $null
$taskDesktopProcess = Start-Process -FilePath $taskDesktopPath -WindowStyle Hidden -PassThru
if (-not $taskDesktopProcess.WaitForExit(60000)) {
  $taskDesktopProcess.Kill()
  throw 'Desktop smoke test did not finish within one minute.'
}
$taskResultFile = Join-Path $taskSmokeDirectory 'smoke-result.json'
if (-not (Test-Path -LiteralPath $taskResultFile)) { throw 'Desktop did not produce its smoke result.' }
$taskResult = Get-Content -LiteralPath $taskResultFile -Raw | ConvertFrom-Json
if ($taskResult.version -ne '2.0.0' -or $taskResult.demo -or $taskResult.cars -ne 0 -or $taskResult.total -ne 0 -or -not $taskResult.excel) {
  throw 'Desktop smoke test returned an unexpected workspace or invalid Excel output.'
}
$taskResult | ConvertTo-Json
Remove-Item Env:SCOUT_SMOKE_TEST, Env:SCOUT_DESKTOP_DATA_DIR -ErrorAction SilentlyContinue
