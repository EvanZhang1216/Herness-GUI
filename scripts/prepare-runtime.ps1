param([string]$PythonVersion = '3.11.15')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:UV_PYTHON_INSTALL_DIR = Join-Path $root '.build\cpython'
uv python install $PythonVersion
if ($LASTEXITCODE) { throw 'Portable Python download failed' }
$python = (& uv python find --managed-python $PythonVersion).Trim()
$pythonRoot = Split-Path $python -Parent
New-Item -ItemType Directory runtime\python,runtime\node,runtime\git,runtime\bin -Force | Out-Null
robocopy $pythonRoot runtime\python /E /XD __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw 'Python copy failed' }
uv pip install --python runtime/python/python.exe --break-system-packages --require-hashes -r runtime/requirements.lock.txt
if ($LASTEXITCODE) { throw 'Locked Python dependency installation failed' }
$nodeRoot = Split-Path (Get-Command node).Source -Parent
# Include npm/npx as well: stdio MCP servers often use them. A server's own
# packages must still be downloaded in advance before that server works offline.
robocopy $nodeRoot runtime\node /E /XD node_cache /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw 'Node copy failed' }
$gitExe = (Get-Command git).Source
$gitRoot = Split-Path (Split-Path $gitExe -Parent) -Parent
if (-not (Test-Path (Join-Path $gitRoot 'bin\bash.exe'))) { throw 'Git for Windows with Bash is required on the build host' }
robocopy $gitRoot runtime\git /E /XD dev tmp /XF unins* /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw 'Git copy failed' }
Copy-Item (Get-Command uv).Source runtime\bin\uv.exe
Copy-Item (Get-Command rg).Source runtime\bin\rg.exe
& runtime/python/python.exe -c "import fastapi,openai,anthropic,mcp,sqlite3,ssl; print('Bundled runtime verified')"
if ($LASTEXITCODE) { throw 'Runtime import check failed' }
@{ python=$PythonVersion; node=(& node --version); git=(& git --version); uv=(& uv --version); ripgrep=(& rg --version | Select-Object -First 1) } |
    ConvertTo-Json | Set-Content runtime\manifest.json -Encoding utf8
