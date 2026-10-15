param(
  [string]$MakeNsis = "$env:LOCALAPPDATA/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe"
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runId = [guid]::NewGuid().ToString('N')
$fixture = Join-Path $repo "tmp/installer-safety-$runId"
$stage = Join-Path ([IO.Path]::GetTempPath()) "AureliaInstallerSafety-$runId"
$regKey = "Software\AureliaInstallerSafety-$runId"
$failures = [Collections.Generic.List[string]]::new()
$links = [Collections.Generic.List[string]]::new()
$aclRestores = [Collections.Generic.List[object]]::new()
New-Item -ItemType Directory -Path $fixture, $stage | Out-Null

function Assert-Case([bool]$Condition, [string]$Name) {
  if ($Condition) { Write-Host "PASS $Name" } else { $failures.Add($Name); Write-Host "FAIL $Name" }
}
function Invoke-Probe([string[]]$Arguments, [switch]$Uninstall) {
  $name = if ($Uninstall) { 'uninstall.exe' } else { 'probe.exe' }
  $process = Start-Process -FilePath (Join-Path $stage $name) -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(30000)) { throw "Probe timed out: $name $Arguments" }
  return $process.ExitCode
}
function New-Tree([string]$Name) {
  $path = Join-Path $fixture $Name
  New-Item -ItemType Directory -Path $path | Out-Null
  [IO.File]::WriteAllText((Join-Path $path 'Uninstall.exe'), 'fixture uninstaller')
  [IO.File]::WriteAllText((Join-Path $path 'payload.txt'), 'keep until safe removal')
  return $path
}
function New-Link([string]$Path, [string]$Target) {
  New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
  $links.Add($Path)
}

try {
  $production = Get-Content -LiteralPath (Join-Path $repo 'build/installer.nsh') -Raw -Encoding UTF8
  $functions = [regex]::Match($production, '(?ms)^  Function AuValidatePath\r?\n.*?^  FunctionEnd').Value
  if (-not $functions) { throw 'Production AuValidatePath function was not found' }
  $macroNames = 'customInstall', 'customUnInstall', 'customUnInit'
  $macros = foreach ($name in $macroNames) {
    [regex]::Match($production, "(?ms)^!macro $name\r?\n.*?^!macroend").Value
  }
  # Relocate only the desktop variable; compile the actual policy and helpers.
  $macros = ($macros -join "`n").Replace('$DESKTOP', '$FixtureDesktop')
  $helpers = ''
  if (Test-Path (Join-Path $repo 'build/installer-safety.nsh')) {
    $helpers = "!include `"$repo\build\installer-safety.nsh`"`n!insertmacro AuSafetyFunctions `"`"`n!insertmacro AuSafetyFunctions `"un.`""
  }
  $plugins = Get-ChildItem "$env:LOCALAPPDATA/electron-builder/Cache/nsis-resources-*/**/plugins/x86-unicode/WinShell.dll" | Select-Object -First 1
  if (-not $plugins) { throw 'electron-builder NSIS WinShell plugin is missing' }
  # Reproduce electron-builder's include order, in both compilation modes.
  # The custom include loads BEFORE common.nsh defines executable filenames;
  # customHeader expands AFTER common.nsh. Treat warnings as errors like dist.
  foreach ($compileMode in 'installer', 'uninstaller') {
    $compileSource = @'
Unicode true
RequestExecutionLevel user
; This compile-only fixture does not instantiate interactive page callbacks.
!pragma warning disable 6001
!define PROJECT_DIR "@@REPO@@"
!define APP_GUID "aurelia-installer-safety-compile"
!define APP_FILENAME "Aurelia Safety Compile"
!define SHORTCUT_NAME "Aurelia Safety Compile"
!define INSTALL_REGISTRY_KEY "@@REGKEY@@"
!define UNINSTALL_REGISTRY_KEY "@@REGKEY@@\Uninstall"
!define PRODUCT_NAME "Aurelia Safety Compile"
!define PRODUCT_FILENAME "Aurelia"
!define VERSION "0.0.0"
@@BUILD_MODE@@
!include "@@REPO@@\build\installer.nsh"
!include "@@REPO@@\node_modules\app-builder-lib\templates\nsis\common.nsh"
!include MUI2.nsh
!insertmacro MUI_PAGE_INSTFILES
!ifdef BUILD_UNINSTALLER
  !insertmacro MUI_UNPAGE_INSTFILES
!endif
!insertmacro MUI_LANGUAGE English
!insertmacro MUI_LANGUAGE SimpChinese
!insertmacro customHeader
OutFile "@@OUTPUT@@"
Section
@@INSTALL_CALLS@@
SectionEnd
@@UNINSTALL_SECTION@@
'@
    $modeDefine = ''; $uninstallSection = ''
    $installCalls = 'Call AuValidateUninstallRegistration' + "`n" + 'Call AuValidateTree' + "`n" + 'Push "$TEMP\fixture.lnk"' + "`n" + 'Call AuShortcutOwnership' + "`nPop `$0"
    if ($compileMode -eq 'uninstaller') {
      $modeDefine = '!define BUILD_UNINSTALLER'
      $installCalls = 'WriteUninstaller "$TEMP\never-executed-safety-compile.exe"'
      $uninstallSection = "Section Uninstall`nCall un.AuRequireSafeTree`n" + 'Push "$TEMP\fixture.lnk"' + "`nCall un.AuShortcutOwnership`nPop `$0`nSectionEnd"
    }
    $compileSource = $compileSource.Replace('@@REPO@@', $repo).Replace('@@REGKEY@@', $regKey).Replace('@@BUILD_MODE@@', $modeDefine).Replace('@@OUTPUT@@', "$fixture\compile-$compileMode.exe").Replace('@@INSTALL_CALLS@@', $installCalls).Replace('@@UNINSTALL_SECTION@@', $uninstallSection)
    $compileNsi = Join-Path $fixture "compile-$compileMode.nsi"
    [IO.File]::WriteAllText($compileNsi, $compileSource)
    & $MakeNsis /WX /V2 $compileNsi
    if ($LASTEXITCODE -ne 0) { throw "Production include-order compile failed ($compileMode): $LASTEXITCODE" }
    Write-Host "PASS production include-order compilation $compileMode"
  }
  $source = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
!define APP_EXECUTABLE_FILENAME "Aurelia.exe"
!define UNINSTALL_FILENAME "Uninstall.exe"
!define APP_ID "aurelia.installer.safety.probe"
!define APP_GUID "aurelia-installer-safety-probe"
!define SHORTCUT_NAME "Aurelia Safety Probe"
!define INSTALL_REGISTRY_KEY "@@REGKEY@@"
!define UNINSTALL_REGISTRY_KEY "@@REGKEY@@\Uninstall"
!define isKeepShortcuts '"0" == "1"'
!addplugindir "@@PLUGINS@@"
OutFile "@@OUTPUT@@"
Name "Aurelia installer safety probe"
Var AuValid
Var AuExisting
Var AuRecoveryPath
Var AuDesktop
Var FixtureDesktop
Var Mode
LangString AuSpace 1033 "Space"
LangString AuInvalid 1033 "Unsafe"
LangString AuUnsafeTree 1033 "Unsafe tree"
@@HELPERS@@
!include "@@REPO@@\scripts\fixtures\installer-0.10.0-uninstall.nsh"
@@MACROS@@
Function AuSelectRecoveryPath
FunctionEnd
@@FUNCTIONS@@
Section
  ${GetParameters} $0
  ${GetOptions} $0 "/ROOT=" $INSTDIR
  ${GetOptions} $0 "/DESKTOP=" $FixtureDesktop
  ${GetOptions} $0 "/MODE=" $Mode
  ${If} $Mode == "make-uninstaller"
    WriteUninstaller "@@STAGE@@\uninstall.exe"
  ${ElseIf} $Mode == "validate"
  ${OrIf} $Mode == "validate-record"
    StrCpy $AuExisting $INSTDIR
    ${If} $Mode == "validate-record"
      ReadRegStr $AuExisting HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    StrCpy $AuRecoveryPath ""
    Call AuValidatePath
    ${If} $AuValid != "1"
      SetErrorLevel 2
      Quit
    ${EndIf}
    FileOpen $0 "$INSTDIR\passed-guard.txt" w
    FileWrite $0 "old uninstaller may now start"
    FileClose $0
  ${ElseIf} $Mode == "legacy-upgrade"
    StrCpy $AuExisting $INSTDIR
    Call AuValidatePath
    ${If} $AuValid != "1"
      SetErrorLevel 2
      Quit
    ${EndIf}
    !ifmacrodef AuPrepareLegacyShortcut
      !insertmacro AuPrepareLegacyShortcut "$FixtureDesktop\${SHORTCUT_NAME}.lnk"
    !endif
    !insertmacro LegacyCustomUnInstall "$FixtureDesktop\${SHORTCUT_NAME}.lnk"
  ${Else}
    ${GetOptions} $0 "/ENABLED=" $AuDesktop
    !insertmacro customInstall
  ${EndIf}
SectionEnd
Function un.onInit
  ${GetParameters} $0
  ${GetOptions} $0 "/DESKTOP=" $FixtureDesktop
  !ifmacrodef customUnInit
    !insertmacro customUnInit
  !endif
FunctionEnd
Section Uninstall
  !insertmacro customUnInstall
  Delete "$INSTDIR\payload.txt"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
SectionEnd
'@
  $source = $source.Replace('@@REGKEY@@', $regKey).Replace('@@REPO@@', $repo).Replace('@@PLUGINS@@', $plugins.DirectoryName).Replace('@@OUTPUT@@', "$fixture\probe.exe").Replace('@@STAGE@@', $stage).Replace('@@HELPERS@@', $helpers).Replace('@@MACROS@@', $macros).Replace('@@FUNCTIONS@@', $functions)
  $nsi = Join-Path $fixture 'probe.nsi'
  [IO.File]::WriteAllText($nsi, $source)
  & $MakeNsis /V2 $nsi
  if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed: $LASTEXITCODE" }
  # Writing bytes creates an ordinary-integrity executable; copying from a
  # sandbox-labelled workspace can leave NSIS unable to initialize plugins.
  [IO.File]::WriteAllBytes((Join-Path $stage 'probe.exe'), [IO.File]::ReadAllBytes((Join-Path $fixture 'probe.exe')))
  $desktop = Join-Path $fixture 'desktop'
  New-Item -ItemType Directory -Path $desktop | Out-Null
  $shortcut = "$desktop\Aurelia Safety Probe.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $code = Invoke-Probe @('/S', '/MODE=make-uninstaller')
  if ($code -ne 0) { throw "Cannot generate uninstaller: $code" }
  $external = New-Tree 'external'
  [IO.File]::WriteAllText((Join-Path $external 'sentinel.txt'), 'external sentinel')
  foreach ($case in 'ordinary', 'ordinary-nested', 'root-link', 'ancestor-link', 'nested-link', 'dangling-link', 'unreadable-root', 'unreadable-child') {
    $root = New-Tree $case
    switch ($case) {
      'ordinary-nested' { New-Item -ItemType Directory -Path "$root\nested\empty" -Force | Out-Null; [IO.File]::WriteAllText("$root\nested\file.txt", 'nested fixture') }
      'root-link' { $root = Join-Path $fixture 'root-alias'; New-Link $root $external }
      'ancestor-link' { New-Item -ItemType Directory -Path "$external\app" | Out-Null; [IO.File]::WriteAllText("$external\app\Uninstall.exe", 'fixture'); $alias = Join-Path $fixture 'ancestor-alias'; New-Link $alias $external; $root = "$alias\app" }
      'nested-link' { New-Item -ItemType Directory -Path "$root\deep" | Out-Null; New-Link "$root\deep\linked" $external }
      'dangling-link' { New-Item -ItemType Directory -Path "$fixture\missing-target" | Out-Null; New-Link "$root\dangling" "$fixture\missing-target"; [IO.Directory]::Delete("$fixture\missing-target") }
      { $_ -in 'unreadable-root', 'unreadable-child' } {
        $denied = if ($case -eq 'unreadable-root') { $root } else { New-Item -ItemType Directory -Path "$root\unreadable" | Select-Object -ExpandProperty FullName }
        $aclRestores.Add(@{ Path = $denied; Acl = (Get-Acl -LiteralPath $denied) })
        $acl = Get-Acl -LiteralPath $denied
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::ListDirectory, [Security.AccessControl.AccessControlType]::Deny)
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $denied -AclObject $acl
      }
    }
    $ordinary = $case -in 'ordinary', 'ordinary-nested'
    $expected = if ($ordinary) { 0 } else { 2 }
    $code = Invoke-Probe @('/S', '/MODE=validate', "/ROOT=`"$root`"")
    Assert-Case ($code -eq $expected) "upgrade guard $case (exit $code, want $expected)"
    Assert-Case ((Test-Path "$root\passed-guard.txt") -eq $ordinary) "upgrade mutation boundary $case"
    New-Item -Path "HKCU:\$regKey" -Force | Out-Null
    New-ItemProperty -Path "HKCU:\$regKey" -Name AureliaDesktopShortcut -Value 1 -PropertyType DWord -Force | Out-Null
    $link = $shell.CreateShortcut($shortcut); $link.TargetPath = "$root\Aurelia.exe"; $link.Save()
    $code = Invoke-Probe @('/S', "/DESKTOP=`"$desktop`"", "_?=$root") -Uninstall
    Assert-Case ($code -eq $expected) "direct uninstall guard $case (exit $code, want $expected)"
    if (-not $ordinary) {
      Assert-Case (Test-Path "HKCU:\$regKey") "unsafe uninstall preserves registration $case"
      Assert-Case (Test-Path $shortcut) "unsafe uninstall preserves shortcut $case"
      if ($case -ne 'ancestor-link') { Assert-Case (Test-Path "$root\payload.txt") "unsafe uninstall preserves files $case" }
    } else { Assert-Case (-not (Test-Path "$root\payload.txt")) "safe uninstall removes payload $case" }
    Assert-Case (Test-Path "$external\sentinel.txt") "external sentinel preserved $case"
  }
  $root = New-Tree 'shortcuts'
  [IO.File]::WriteAllText("$root\Aurelia.exe", 'fixture application')
  Remove-Item -LiteralPath $shortcut -Force
  $code = Invoke-Probe @('/S', '/MODE=shortcut', '/ENABLED=1', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case (($code -eq 0) -and (Test-Path $shortcut)) 'shortcut enabled creates owned link'
  Assert-Case ($shell.CreateShortcut($shortcut).TargetPath -eq "$root\Aurelia.exe") 'created shortcut targets the installation'
  Assert-Case ((Get-ItemProperty "HKCU:\$regKey").AureliaDesktopShortcut -eq 1) 'enabled shortcut records ownership'
  $code = Invoke-Probe @('/S', '/MODE=shortcut', '/ENABLED=0', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case (($code -eq 0) -and -not (Test-Path $shortcut)) 'shortcut disabled removes owned link'
  Assert-Case ((Get-ItemProperty "HKCU:\$regKey").AureliaDesktopShortcut -eq 0) 'disabled shortcut clears ownership'
  $code = Invoke-Probe @('/S', '/MODE=shortcut', '/ENABLED=1', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case (($code -eq 0) -and (Test-Path $shortcut)) 'reinstall recreates enabled shortcut'
  $link = $shell.CreateShortcut($shortcut); $link.TargetPath = "$external\foreign.exe"; $link.Save()
  $code = Invoke-Probe @('/S', '/MODE=shortcut', '/ENABLED=0', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case ((Test-Path $shortcut) -and $shell.CreateShortcut($shortcut).TargetPath -eq "$external\foreign.exe") 'disabled preference preserves foreign shortcut'
  $code = Invoke-Probe @('/S', '/MODE=shortcut', '/ENABLED=1', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case ($shell.CreateShortcut($shortcut).TargetPath -eq "$external\foreign.exe") 'enabled preference preserves foreign shortcut'
  Assert-Case ((Get-ItemProperty "HKCU:\$regKey").AureliaDesktopShortcut -eq 0) 'foreign shortcut is not registered as owned'
  New-ItemProperty -Path "HKCU:\$regKey" -Name AureliaDesktopShortcut -Value 1 -PropertyType DWord -Force | Out-Null
  $code = Invoke-Probe @('/S', "/DESKTOP=`"$desktop`"", "_?=$root") -Uninstall
  Assert-Case ((Test-Path $shortcut) -and $shell.CreateShortcut($shortcut).TargetPath -eq "$external\foreign.exe") 'uninstall preserves repurposed shortcut with stale ownership'
  $link = $shell.CreateShortcut($shortcut); $link.TargetPath = "$root\Aurelia.exe"; $link.Save()
  New-Item -Path "HKCU:\$regKey" -Force | Out-Null
  New-ItemProperty -Path "HKCU:\$regKey" -Name AureliaDesktopShortcut -Value 0 -PropertyType DWord -Force | Out-Null
  $code = Invoke-Probe @('/S', "/DESKTOP=`"$desktop`"", "_?=$root") -Uninstall
  Assert-Case (($code -eq 0) -and -not (Test-Path $shortcut)) 'uninstall removes owned shortcut even with stale disabled flag'
  foreach ($case in 'orphan-record', 'mismatched-record', 'valid-record', 'fresh-no-record') {
    if (Test-Path "HKCU:\$regKey") { Remove-Item -LiteralPath "HKCU:\$regKey" -Recurse -Force }
    $target = Join-Path $fixture $case
    New-Item -ItemType Directory -Path $target | Out-Null
    if ($case -in 'mismatched-record', 'valid-record') {
      [IO.File]::WriteAllText("$target\Uninstall.exe", 'fixture')
      New-Item -Path "HKCU:\$regKey" -Force | Out-Null
      New-ItemProperty -Path "HKCU:\$regKey" -Name InstallLocation -Value $target -Force | Out-Null
    }
    if ($case -ne 'fresh-no-record') {
      $oldPath = if ($case -eq 'valid-record') { $target } else { $external }
      New-Item -Path "HKCU:\$regKey\Uninstall" -Force | Out-Null
      New-ItemProperty -Path "HKCU:\$regKey\Uninstall" -Name UninstallString -Value "`"$oldPath\Uninstall.exe`" /currentuser" -Force | Out-Null
    }
    $expected = if ($case -in 'valid-record', 'fresh-no-record') { 0 } else { 2 }
    $code = Invoke-Probe @('/S', '/MODE=validate-record', "/ROOT=`"$target`"")
    Assert-Case ($code -eq $expected) "registration boundary $case (exit $code, want $expected)"
    Assert-Case ((Test-Path "$target\passed-guard.txt") -eq ($expected -eq 0)) "registration rejection precedes old removal $case"
    Assert-Case (Test-Path "$external\sentinel.txt") "registration preserves old external sentinel $case"
  }
  if (Test-Path "HKCU:\$regKey") { Remove-Item -LiteralPath "HKCU:\$regKey" -Recurse -Force }
  New-Item -Path "HKCU:\$regKey" -Force | Out-Null
  New-ItemProperty -Path "HKCU:\$regKey" -Name AureliaDesktopShortcut -Value 1 -PropertyType DWord -Force | Out-Null
  $link = $shell.CreateShortcut($shortcut); $link.TargetPath = "$external\foreign.exe"; $link.Save()
  Remove-Item -LiteralPath "$root\Aurelia.exe" -Force
  $code = Invoke-Probe @('/S', '/MODE=legacy-upgrade', "/ROOT=`"$root`"", "/DESKTOP=`"$desktop`"")
  Assert-Case (($code -eq 0) -and (Test-Path $shortcut)) 'legacy uninstall with missing executable preserves foreign shortcut'
  if ($failures.Count) { throw "$($failures.Count) installer safety regressions: $($failures -join '; ')" }
  Write-Host 'All executable NSIS safety regressions passed.'
} finally {
  foreach ($entry in $aclRestores) { Set-Acl -LiteralPath $entry.Path -AclObject $entry.Acl }
  foreach ($linkPath in $links) {
    if (-not ([IO.Path]::GetFullPath($linkPath).StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Unsafe junction cleanup path' }
    # Delete the junction itself, never recursively enumerate its target.
    if ([IO.Directory]::Exists($linkPath) -or (Test-Path -LiteralPath $linkPath)) { [IO.Directory]::Delete($linkPath) }
  }
  if (Test-Path "HKCU:\$regKey") { Remove-Item -LiteralPath "HKCU:\$regKey" -Recurse -Force }
  foreach ($cleanup in @($fixture, $stage)) {
    $expectedParent = if ($cleanup -eq $fixture) { Join-Path $repo 'tmp' } else { [IO.Path]::GetTempPath().TrimEnd('\') }
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($cleanup)) -ne [IO.Path]::GetFullPath($expectedParent)) { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $cleanup -Recurse -Force
  }
}
