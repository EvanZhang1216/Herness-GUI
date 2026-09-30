$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compiler = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis-*') -Recurse -Filter makensis.exe | Select-Object -First 1 -ExpandProperty FullName
if (-not $compiler) { throw 'Build an installer first to populate the NSIS compiler cache.' }
$outputDir = Join-Path $projectRoot 'verification\installer-paths'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$testExe = Join-Path $outputDir 'installer-paths-test.exe'
$resultFile = Join-Path $outputDir 'result.txt'
& $compiler /V2 "/DOUTPUT=$testExe" "/DRESULT=$resultFile" (Join-Path $projectRoot 'apps\desktop\scripts\installer-paths-test.nsi')
if ($LASTEXITCODE) { throw 'NSIS regression fixture compilation failed' }
$process = Start-Process -FilePath $testExe -WindowStyle Hidden -Wait -PassThru
Get-Content -LiteralPath $resultFile
if ($process.ExitCode) { throw 'NSIS directory boundary regression failed' }
