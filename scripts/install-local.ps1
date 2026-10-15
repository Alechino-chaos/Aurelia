param([string]$ApplicationRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$setupPath = Join-Path $projectRoot "release\Aurelia-$($package.version)-setup.exe"
if (-not (Test-Path -LiteralPath $setupPath)) { throw 'Build the Windows installer with npm run dist first.' }
$registryPath = 'HKCU:\Software\8e3b71f6-b014-4f5d-83d9-ea8146edc067'
$previousPath = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue).InstallLocation
if ($previousPath) {
    if ($ApplicationRoot -and [IO.Path]::GetFullPath($ApplicationRoot).TrimEnd('\') -ne $previousPath.TrimEnd('\')) { throw 'An installed app already exists. Updates must keep its registered installation path.' }
    $ApplicationRoot = $previousPath
}
if (-not $ApplicationRoot) { $ApplicationRoot = Join-Path $env:LOCALAPPDATA 'Programs\Aurelia' }
$applicationRoot = [IO.Path]::GetFullPath($ApplicationRoot).TrimEnd('\')
if ($applicationRoot -match '["\r\n]') { throw 'Invalid installation path' }
# Normal closure lets the app complete its save-before-close handshake.
$runningApps = @(Get-Process -Name Aurelia -ErrorAction SilentlyContinue)
foreach ($runningApp in $runningApps) { if ($runningApp.MainWindowHandle -ne 0) { $null = $runningApp.CloseMainWindow() } }
$closeDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    $runningApps = @(Get-Process -Name Aurelia -ErrorAction SilentlyContinue)
    if (-not $runningApps.Count) { break }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $closeDeadline)
if ($runningApps.Count) { throw 'Aurelia is still running. Close it normally and retry; no process was forced to stop.' }
# A Low-integrity workspace can prevent NSIS from writing normal application
# directories. Copy the artifact into a fresh ordinary-user staging directory.
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('Aurelia-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingRoot | Out-Null
$stagedSetup = Join-Path $stagingRoot (Split-Path -Leaf $setupPath)
Copy-Item -LiteralPath $setupPath -Destination $stagedSetup
if ((Get-FileHash -LiteralPath $stagedSetup).Hash -ne (Get-FileHash -LiteralPath $setupPath).Hash) { throw 'Staged installer mismatch.' }
# NSIS requires /D to be last and unquoted, including when it contains spaces.
$setup = Start-Process -FilePath $stagedSetup -ArgumentList "/S /currentuser /D=$applicationRoot" -WindowStyle Hidden -PassThru
if (-not $setup.WaitForExit(180000)) { throw 'Installer is still running. Inspect it before retrying.' }
if ($setup.ExitCode -ne 0) { throw "Installer failed with exit code $($setup.ExitCode)." }
Remove-Item -LiteralPath $stagedSetup
Remove-Item -LiteralPath $stagingRoot
$registeredPath = (Get-ItemProperty -LiteralPath $registryPath).InstallLocation
if ($registeredPath.TrimEnd('\') -ne $applicationRoot) { throw 'Registered installation path does not match.' }
$installedExecutable = Join-Path $registeredPath 'Aurelia.exe'
$installedAsar = Join-Path $registeredPath 'resources\app.asar'
foreach ($relativePath in @('Aurelia.exe','resources\app.asar')) {
    if ((Get-FileHash -LiteralPath (Join-Path $registeredPath $relativePath)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot "release\win-unpacked\$relativePath")).Hash) { throw "Installed file mismatch: $relativePath" }
}
if (-not (Test-Path -LiteralPath (Join-Path $registeredPath 'Uninstall Aurelia.exe'))) { throw 'Uninstaller missing.' }
$shortcutPath = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Aurelia.lnk'
$shortcutTarget = $null
if (Test-Path -LiteralPath $shortcutPath) {
    $shortcutTarget = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath).TargetPath
    if ($shortcutTarget -ne $installedExecutable) { throw 'Desktop shortcut points to a different application.' }
}
$record = [ordered]@{version=$package.version; installationType='nsis'; applicationRoot=$registeredPath; executablePath=$installedExecutable; shortcutPath=$(if ($shortcutTarget) {$shortcutPath} else {$null}); installedAt=(Get-Date -Format o)}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.aurelia-install.local.json') -Encoding utf8
$record | ConvertTo-Json
