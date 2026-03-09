$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$vscodeTestRoot = Join-Path $repoRoot '.vscode-test'
$codeCmd = Get-ChildItem -Path $vscodeTestRoot -Recurse -Filter code.cmd |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $codeCmd) {
    throw 'Unable to locate a VS Code CLI test host under .vscode-test.'
}

$codeExecutable = Join-Path (Split-Path -Parent (Split-Path -Parent $codeCmd)) 'Code.exe'

$userDataDir = Join-Path $vscodeTestRoot ("user-data-" + [Guid]::NewGuid().ToString('N'))
$extensionsDir = Join-Path $vscodeTestRoot 'extensions'
$extensionDevelopmentPath = $repoRoot
$extensionTestsPath = Join-Path $repoRoot 'out\test\suite\index.js'

New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $extensionsDir | Out-Null

$previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

try {
    $stdoutPath = Join-Path $vscodeTestRoot 'host-test-stdout.log'
    $stderrPath = Join-Path $vscodeTestRoot 'host-test-stderr.log'
    $arguments = @(
        '--new-window'
        '--wait'
        '--disable-extensions'
        '--disable-crash-reporter'
        '--skip-welcome'
        '--skip-release-notes'
        "--user-data-dir=$userDataDir"
        "--extensions-dir=$extensionsDir"
        "--extensionDevelopmentPath=$extensionDevelopmentPath"
        "--extensionTestsPath=$extensionTestsPath"
    )

    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    $process = Start-Process -FilePath $codeExecutable `
        -ArgumentList $arguments `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    if (Test-Path $stdoutPath) {
        Get-Content $stdoutPath
    }
    if (Test-Path $stderrPath) {
        Get-Content $stderrPath
    }

    exit $process.ExitCode
} finally {
    if ($null -ne $previousElectronRunAsNode) {
        $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
}
