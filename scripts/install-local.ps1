param([string]$ApplicationRoot)
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'release\win-unpacked'
$sourceExecutable = Join-Path $sourceDirectory 'Aurelia.exe'
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw 'Build the Windows application with npm run dist first.'
}

# Install outside the source workspace. The source workspace can
# carry a Low integrity label that prevents Chromium from starting its sandbox.
# Copy files; never change security labels or disable the application sandbox.
if (-not $ApplicationRoot) {
    $recordPath = Join-Path $projectRoot '.aurelia-install.local.json'
    if (Test-Path -LiteralPath $recordPath) {
        $previousInstall = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        $ApplicationRoot = $previousInstall.applicationRoot
    }
    if (-not $ApplicationRoot) { $ApplicationRoot = Join-Path $env:LOCALAPPDATA 'Programs\Aurelia' }
}
$applicationRoot = [IO.Path]::GetFullPath($ApplicationRoot)
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$buildId = '{0}-{1}' -f $package.version, (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$installDirectory = [IO.Path]::GetFullPath((Join-Path $applicationRoot $buildId))
if (-not $installDirectory.StartsWith($applicationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unexpected installation path.'
}
if (Test-Path -LiteralPath $installDirectory) {
    throw 'This build directory already exists. Run the script again to use a new directory.'
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $installDirectory -Recurse
}
$installedExecutable = Join-Path $installDirectory 'Aurelia.exe'
if ((Get-FileHash -LiteralPath $sourceExecutable).Hash -ne (Get-FileHash -LiteralPath $installedExecutable).Hash) {
    throw 'The application copy did not pass verification.'
}

$shortcutPath = & (Join-Path $PSScriptRoot 'update-shortcut.ps1') -Executable $installedExecutable -ApplicationRoot $applicationRoot
$shortcutShell = New-Object -ComObject WScript.Shell

$record = [ordered]@{
    version = $package.version
    applicationRoot = $applicationRoot
    executablePath = $installedExecutable
    shortcutPath = $shortcutPath
    installedAt = (Get-Date -Format o)
}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.aurelia-install.local.json') -Encoding utf8
# Retire only this project's old shortcut once the new shortcut is saved.
# Leave the old application and user profile intact.
$legacyRecordPath = Join-Path $projectRoot '.paperdesk-install.local.json'
if (Test-Path -LiteralPath $legacyRecordPath) {
    $legacyRecord = Get-Content -LiteralPath $legacyRecordPath -Raw | ConvertFrom-Json
    $legacyShortcutPath = Join-Path $projectRoot '启动 PaperDesk.lnk'
    if (Test-Path -LiteralPath $legacyShortcutPath) {
        $legacyShortcut = $shortcutShell.CreateShortcut($legacyShortcutPath)
        if ($legacyShortcut.TargetPath -eq $legacyRecord.executablePath) {
            Remove-Item -LiteralPath $legacyShortcutPath
        }
    }
}
$record | ConvertTo-Json
