!ifndef AURELIA_INSTALLER_SAFETY_INCLUDED
!define AURELIA_INSTALLER_SAFETY_INCLUDED
!include LogicLib.nsh
!include FileFunc.nsh
!include Win\COM.nsh

Var AuTreeSafe
Var AuScanDepth
!ifndef BUILD_UNINSTALLER
  Var AuRegistrationSafe
!endif

; The legacy custom uninstaller trusts its registry flag. Stock NSIS may omit
; --keep-shortcuts when the old EXE is missing, so clear stale foreign ownership
; BEFORE invoking that legacy code. The caller must finish all safety guards
; before expanding this macro; failure to write must abort the upgrade.
!macro AuPrepareLegacyShortcut ShortcutPath
  Push $0
  ReadRegDWORD $0 HKCU "${INSTALL_REGISTRY_KEY}" AureliaDesktopShortcut
  ${If} $0 == 1
    Push "${ShortcutPath}"
    Call AuShortcutOwnership
    Pop $0
    ${If} $0 != 1
      ClearErrors
      WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" AureliaDesktopShortcut 0
      ${If} ${Errors}
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend

; Used before the OLD uninstaller starts and by the new direct uninstaller.
; Missing fresh-install directories are allowed; unreadable trees fail closed.
!macro AuSafetyFunctions Prefix
!if "${Prefix}" == ""
; Stock uninstallOldVersion falls back to UninstallString's directory when
; InstallLocation is absent. Reject that orphaned state instead of validating
; the new directory while the old uninstaller removes an unvalidated one.
Function AuValidateUninstallRegistration
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $AuRegistrationSafe 1
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $0 == ""
      ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    ${EndIf}
  !endif
  ${If} $0 != ""
    StrCpy $AuRegistrationSafe 0
    ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $1 != ""
      System::Call 'kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r2, p 0)i.r3'
      ${If} $3 > 0
      ${AndIf} $3 < ${NSIS_MAX_STRLEN}
      ${AndIf} $2 == "$INSTDIR"
        ; These are the per-user commands written by our stock NSIS template.
        ; Do not execute an arbitrary path or silently adopt a foreign record.
        StrCpy $1 '$\"$INSTDIR\${UNINSTALL_FILENAME}$\"'
        StrCpy $2 '$\"$INSTDIR\${UNINSTALL_FILENAME}$\" /currentuser'
        ${If} $0 == $1
        ${OrIf} $0 == $2
          StrCpy $AuRegistrationSafe 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

Function ${Prefix}AuValidateTree
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $AuTreeSafe 0
  StrCpy $AuScanDepth 0
  StrCpy $0 "$INSTDIR" 2 1
  ${If} $0 != ":\"
    Goto treeDone
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0)i.r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
    Goto treeDone
  ${EndIf}
  ${GetRoot} "$0" $1
  ${If} $0 == "$1\"
  ${OrIf} $0 == "$PROFILE"
  ${OrIf} $0 == "$APPDATA"
  ${OrIf} $0 == "$LOCALAPPDATA"
  ${OrIf} $0 == "$DESKTOP"
    Goto treeDone
  ${EndIf}
  System::Call 'kernel32::GetDriveTypeW(w "$1\")i.r2'
  ${If} $2 != 2
  ${AndIf} $2 != 3
    Goto treeDone
  ${EndIf}
  ${Do}
    ${If} $0 == "$WINDIR"
    ${OrIf} $0 == "$PROGRAMFILES"
    ${OrIf} $0 == "$PROGRAMFILES64"
      Goto treeDone
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w r0)i.r2 ?e'
    Pop $3
    ${If} $2 == -1
      ${If} $3 != 2
      ${AndIf} $3 != 3
        Goto treeDone
      ${EndIf}
    ${Else}
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        Goto treeDone
      ${EndIf}
      IntOp $3 $2 & 0x10
      ${If} $3 == 0
        Goto treeDone
      ${EndIf}
    ${EndIf}
    ${GetParent} "$0" $1
    ${If} $1 == ""
    ${OrIf} $1 == "$0"
      ${Break}
    ${EndIf}
    StrCpy $0 "$1"
  ${Loop}
  StrCpy $AuTreeSafe 1
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR")i.r2 ?e'
  Pop $3
  ${If} $2 != -1
    Push "$INSTDIR"
    Call ${Prefix}AuScanDirectory
  ${ElseIf} $3 != 2
  ${AndIf} $3 != 3
    StrCpy $AuTreeSafe 0
  ${EndIf}
treeDone:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; WIN32_FIND_DATAW reports reparse points even for dangling links. Native
; enumeration distinguishes exhaustion from access/IO errors. Bound depth and
; path length rather than silently scanning truncated or excessively deep paths.
Function ${Prefix}AuScanDirectory
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  IntOp $AuScanDepth $AuScanDepth + 1
  ${If} $AuScanDepth > 64
    StrCpy $AuTreeSafe 0
    Goto scanDone
  ${EndIf}
  StrLen $1 "$0"
  IntOp $1 $1 + 3
  ${If} $1 >= ${NSIS_MAX_STRLEN}
    StrCpy $AuTreeSafe 0
    Goto scanDone
  ${EndIf}
  System::Alloc 592
  Pop $2
  ${If} $2 == 0
    StrCpy $AuTreeSafe 0
    Goto scanDone
  ${EndIf}
  System::Call 'kernel32::FindFirstFileW(w "$0\*", p r2)p.r1 ?e'
  Pop $3
  ${If} $1 == -1
    ${If} $3 != 2
      StrCpy $AuTreeSafe 0
    ${EndIf}
    Goto scanFree
  ${EndIf}
  ${Do}
    System::Call '*$2(i .r3)'
    IntOp $4 $3 & 0x400
    ${If} $4 != 0
      StrCpy $AuTreeSafe 0
      ${Break}
    ${EndIf}
    IntOp $4 $3 & 0x10
    ${If} $4 != 0
      IntOp $4 $2 + 44
      System::Call '*$4(&w260 .r3)'
      ${If} $3 != "."
      ${AndIf} $3 != ".."
        StrLen $4 "$0"
        StrLen $5 "$3"
        IntOp $4 $4 + $5
        IntOp $4 $4 + 1
        ${If} $4 >= ${NSIS_MAX_STRLEN}
          StrCpy $AuTreeSafe 0
          ${Break}
        ${EndIf}
        Push "$0\$3"
        Call ${Prefix}AuScanDirectory
        ${If} $AuTreeSafe != 1
          ${Break}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::FindNextFileW(p r1, p r2)i.r3 ?e'
    Pop $4
    ${If} $3 == 0
      ${If} $4 != 18
        StrCpy $AuTreeSafe 0
      ${EndIf}
      ${Break}
    ${EndIf}
  ${Loop}
  System::Call 'kernel32::FindClose(p r1)'
scanFree:
  System::Free $2
scanDone:
  IntOp $AuScanDepth $AuScanDepth - 1
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!if "${Prefix}" == "un."
Function ${Prefix}AuRequireSafeTree
  Call ${Prefix}AuValidateTree
  ${If} $AuTreeSafe != 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(AuUnsafeTree)"
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd
!endif

; Stack: shortcut path -> 0 absent, 1 targets this installation, 2 foreign or
; unreadable. Do not resolve links (which can search a network or rewrite one).
Function ${Prefix}AuShortcutOwnership
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $5 2
  System::Call 'kernel32::GetFileAttributesW(w r0)i.r1 ?e'
  Pop $2
  ${If} $1 == -1
    ${If} $2 == 2
    ${OrIf} $2 == 3
      StrCpy $5 0
    ${EndIf}
    Goto shortcutDone
  ${EndIf}
  IntOp $1 $1 & 0x410
  ${If} $1 != 0
    Goto shortcutDone
  ${EndIf}
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r1 ""
  ${If} $1 == 0
    Goto shortcutDone
  ${EndIf}
  StrCpy $2 0
  ${IUnknown::QueryInterface} $1 '("${IID_IPersistFile}", .r2)'
  ${If} $2 != 0
    ${IPersistFile::Load} $2 '(r0, 0).r3'
    ${If} $3 == 0
      ${IShellLink::GetPath} $1 '(.r4, ${NSIS_MAX_STRLEN}, 0, 4).r3'
      ${If} $3 == 0
      ${AndIf} $4 != ""
        System::Call 'kernel32::GetFullPathNameW(w r4, i ${NSIS_MAX_STRLEN}, w .r0, p 0)i.r3'
        ${If} $3 > 0
        ${AndIf} $3 < ${NSIS_MAX_STRLEN}
          System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", i ${NSIS_MAX_STRLEN}, w .r4, p 0)i.r3'
          ${If} $3 > 0
          ${AndIf} $3 < ${NSIS_MAX_STRLEN}
          ${AndIf} $0 == $4
            StrCpy $5 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${IUnknown::Release} $2 ''
  ${EndIf}
  ${IUnknown::Release} $1 ''
shortcutDone:
  StrCpy $0 $5
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd
!macroend
!endif
