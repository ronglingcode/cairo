param(
    [string]$Model = 'gpt-4.1',
    [string]$SecretsFile = '',
    [string]$UserDataPath = '',
    [string]$NodeDirectory = ''
)

$ErrorActionPreference = 'Stop'
$cairoRoot = Split-Path -Parent $PSScriptRoot
if (-not $NodeDirectory) {
    $installedNode = Get-Command node -ErrorAction SilentlyContinue
    $installedVersion = if ($installedNode) { & $installedNode.Source --version } else { 'v0.0.0' }
    if ([version]$installedVersion.TrimStart('v') -lt [version]'22.18.0') {
        $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
        if (Test-Path (Join-Path $bundledNode 'node.exe')) { $NodeDirectory = $bundledNode }
    }
}
if ($NodeDirectory) { $env:PATH = "$NodeDirectory;$env:PATH" }
$npmCommand = Get-Command npm.cmd
$npmCli = Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { throw 'Cannot find npm-cli.js alongside npm.cmd.' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion.TrimStart('v') -lt [version]'22.18.0') {
    throw 'Use Node 22.18 or newer, or provide -NodeDirectory pointing to Node 24.'
}
if (-not (Test-Path (Join-Path $cairoRoot 'node_modules\electron\dist\electron.exe'))) {
    throw 'Install dependencies first: npm ci (using Node 24).'
}
if (-not $Model.Trim()) { throw 'Specify an OpenAI model ID with -Model.' }
if (-not $UserDataPath) {
    if ($env:CAIRO_USER_DATA) {
        $UserDataPath = $env:CAIRO_USER_DATA
    } else {
        # Let the same migration used by Electron run before updating model settings.
        $legacyPath = Join-Path $env:APPDATA 'cairo'
        $UserDataPath = & node (Join-Path $PSScriptRoot 'prepare-user-data.mjs') $legacyPath
        if ($LASTEXITCODE -ne 0) { throw 'Cairo profile migration failed; existing files were preserved.' }
    }
}
$UserDataPath = [IO.Path]::GetFullPath($UserDataPath)
$configPath = Join-Path $UserDataPath 'config.json'
$config = if (Test-Path $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
if ($config -isnot [pscustomobject]) { throw 'Cairo config must be a JSON object.' }
$config | Add-Member -NotePropertyName provider -NotePropertyValue 'openai' -Force
$config | Add-Member -NotePropertyName model -NotePropertyValue $Model.Trim() -Force
if ($SecretsFile) {
    $config | Add-Member -NotePropertyName secretsFile -NotePropertyValue ([IO.Path]::GetFullPath($SecretsFile)) -Force
}

$previousProfile = $env:CAIRO_USER_DATA
try {
    if (-not $config.secretsFile) {
        throw "Set the storeSecrets.js path with -SecretsFile or secretsFile in $configPath."
    }
    $keyStatus = & node (Join-Path $PSScriptRoot 'check-openai-key.mjs') $config.secretsFile
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read referenced credentials; see the error above.' }
    if ($keyStatus -ne 'available') {
        throw 'The referenced storeSecrets.js file must contain openai.apiKey. Update that file and restart Cairo.'
    }
    New-Item -ItemType Directory -Path $UserDataPath -Force | Out-Null
    if (Test-Path $configPath) { Copy-Item -LiteralPath $configPath -Destination "$configPath.before-openai.bak" }
    $json = $config | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($configPath, "$json`n", [Text.UTF8Encoding]::new($false))
    $env:CAIRO_USER_DATA = $UserDataPath
    Write-Host "Starting Cairo with OpenAI model $Model. Settings: $configPath"
    Push-Location $cairoRoot
    try {
        & node $npmCli run dev
        if ($LASTEXITCODE -ne 0) { throw 'Cairo failed to start. See the output above.' }
    } finally { Pop-Location }
} finally {
    $env:CAIRO_USER_DATA = $previousProfile
}
