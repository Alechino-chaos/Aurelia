param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string]$ApplicationRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Aurelia')
)
$ErrorActionPreference = 'Stop'

$applicationRoot = [IO.Path]::GetFullPath($ApplicationRoot)
$installedExecutable = (Resolve-Path -LiteralPath $Executable).Path
if (-not $installedExecutable.StartsWith($applicationRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($installedExecutable) -ne 'Aurelia.exe') {
    throw 'The shortcut must point to an installed Aurelia executable.'
}

# Create in the ordinary Desktop folder, never copy the Low-integrity workspace link.
# Leave the workspace security label and Windows attachment policies unchanged.
$shortcutPath = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Aurelia.lnk'
$shell = New-Object -ComObject WScript.Shell
$previousExecutable = $null
$recordPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.aurelia-install.local.json'
if (Test-Path -LiteralPath $recordPath) {
    $previousExecutable = (Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json).executablePath
}
if (Test-Path -LiteralPath $shortcutPath) {
    $existingTarget = $shell.CreateShortcut($shortcutPath).TargetPath
    if ($existingTarget -ne $previousExecutable -and -not $existingTarget.StartsWith($applicationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'An unrelated Aurelia shortcut already exists on the Desktop.'
    }
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExecutable
$shortcut.WorkingDirectory = Split-Path -Parent $installedExecutable
$shortcut.Description = 'Aurelia - 学术论文 PDF 阅读器'
$shortcut.IconLocation = "$installedExecutable,0"
$shortcut.Save()
if ($shell.CreateShortcut($shortcutPath).TargetPath -ne $installedExecutable) { throw 'Shortcut verification failed.' }

# Retire only our old workspace shortcut after the Desktop shortcut is ready.
$legacyPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Aurelia.lnk'
if (Test-Path -LiteralPath $legacyPath) {
    $legacyTarget = $shell.CreateShortcut($legacyPath).TargetPath
    if ($legacyTarget.StartsWith($applicationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $legacyPath
    }
}
Write-Output $shortcutPath
