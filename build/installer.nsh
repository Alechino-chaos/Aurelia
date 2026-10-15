; Keep the stock NSIS install/uninstall/update engine; customize only the two
; interactive pages and conservative path/process/shortcut policy.
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include WinMessages.nsh
!include "${PROJECT_DIR}\build\installer-safety.nsh"

; The executable may retain Aurelia.exe, but every test installation directory,
; shortcut and registry identity must remain separate from the real application.
!if "${APP_GUID}" == "19e4ad96-9090-4c86-ad10-49b0da8b3ed3"
  !undef APP_FILENAME
  !define APP_FILENAME "Aurelia Upgrade Test"
  !undef SHORTCUT_NAME
  !define SHORTCUT_NAME "Aurelia Upgrade Test"
!endif

!macro customHeader
  SetFont "Segoe UI" 9
  ; common.nsh defines APP_EXECUTABLE_FILENAME after the custom include loads.
  !ifdef BUILD_UNINSTALLER
    !insertmacro AuSafetyFunctions "un."
  !else
    !insertmacro AuSafetyFunctions ""
  !endif
!macroend

LangString AuRunning 1033 "Aurelia is still running. Please close it normally to save your work, then click Retry."
LangString AuUnsafeTree 1033 "The installation contains a linked or unreadable folder. No files have been removed. Remove the link or restore folder access before trying again."
LangString AuUnsafeTree 2052 "安装目录包含链接或无法读取的文件夹，尚未删除任何文件。请移除链接或恢复目录访问权限后重试。"
LangString AuRunning 2052 "Aurelia 仍在运行。请先正常关闭软件以保存阅读记录，再点击重试。"

!ifndef BUILD_UNINSTALLER
Var AuMode
Var AuDialog
Var AuPathInput
Var AuCheckbox
Var AuDesktop
Var AuDefault
Var AuSpaceLabel
Var AuRequired
Var AuAvailable
Var AuTitleFont
Var AuBodyFont
Var AuValid
Var AuExisting
Var AuRecoveryPath
Var AuRecovering

LangString AuWelcome 1033 "Welcome to Aurelia"
LangString AuWelcome 2052 "欢迎安装 Aurelia"
LangString AuMotto 1033 "A journey through research, into ideas."
LangString AuMotto 2052 "以文献为径，开启思想之旅。"
LangString AuInstall 1033 "Install"
LangString AuInstall 2052 "立即安装"
LangString AuCustom 1033 "Custom installation"
LangString AuCustom 2052 "自定义安装"
LangString AuPath 1033 "Installation location"
LangString AuPath 2052 "安装位置"
LangString AuBrowse 1033 "Browse..."
LangString AuBrowse 2052 "浏览…"
LangString AuReset 1033 "Restore default location"
LangString AuReset 2052 "恢复默认位置"
LangString AuShortcut 1033 "Create a desktop shortcut"
LangString AuShortcut 2052 "创建桌面快捷方式"
LangString AuData 1033 "Reading history and annotations stay in your Windows account."
LangString AuData 2052 "阅读记录与批注将保存在当前用户账户中。"
LangString AuBegin 1033 "Start installation"
LangString AuBegin 2052 "开始安装"
LangString AuChoose 1033 "Choose where to install Aurelia."
LangString AuChoose 2052 "选择安装位置与快捷方式。"
LangString AuInvalid 1033 "Choose an empty, writable folder dedicated to Aurelia. System folders, drive roots, network paths and linked folders cannot be used."
LangString AuInvalid 2052 "请选择专用于 Aurelia 的空白、可写文件夹。不能使用系统目录、磁盘根目录、网络路径或链接文件夹。"
LangString AuSpace 1033 "There is not enough free space on this drive."
LangString AuSpace 2052 "所选磁盘的可用空间不足。"
LangString AuOnlyUser 1033 "This installer supports the current Windows user only."
LangString AuOnlyUser 2052 "此安装包仅支持为当前 Windows 用户安装。"
LangString AuRequired 1033 "Required: $AuRequired MB     Available: $AuAvailable MB"
LangString AuRequired 2052 "所需空间：$AuRequired MB     可用空间：$AuAvailable MB"

!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/allusers" $1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "$(AuOnlyUser)"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $AuMode "quick"
  StrCpy $AuDefault "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  StrCpy $AuDesktop "1"
  ReadRegStr $AuExisting HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $AuRecoveryPath HKCU "Software\${APP_GUID}-Recovery" PendingInstallLocation
  StrCpy $AuRecovering "0"
  ${If} $AuExisting == ""
  ${AndIf} $AuRecoveryPath != ""
    StrCpy $AuExisting "$AuRecoveryPath"
    StrCpy $AuRecovering "1"
    Call AuSelectRecoveryPath
  ${EndIf}
  ${If} $AuExisting != ""
    StrCpy $AuDefault "$AuExisting"
    StrCpy $AuDesktop "0"
    Push "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Call AuShortcutOwnership
    Pop $1
    ${If} $1 == 1
      StrCpy $AuDesktop "1"
    ${EndIf}
  ${EndIf}
  ${GetOptions} $0 "--no-desktop-shortcut" $1
  ${IfNot} ${Errors}
    StrCpy $AuDesktop "0"
  ${EndIf}
  ClearErrors
  ; Silent and updated launches skip interactive pages, so validate them here.
  ; The final install-stage guard below also covers every launch mode.
  ${If} ${Silent}
  ${OrIf} ${isUpdated}
    Call AuRequireSafePath
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; Stock installSection calls this before uninstallOldVersion and all writes.
    ; Revalidate the final directory even after page/command-line changes.
    Call AuRequireSafePath
  !endif
  ; Never invoke the template's taskkill fallback on the user's reading app.
  !ifdef BUILD_UNINSTALLER
    Call un.AuRequireSafeTree
  !endif
  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $0
    ${If} $0 != 0
      ${Break}
    ${EndIf}
    ${If} ${Silent}
      ; During an update, allow the releasing process to finish shutting down.
      StrCpy $1 0
      ${Do}
        Sleep 500
        IntOp $1 $1 + 1
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $0
        ${If} $0 != 0
          ${Break}
        ${EndIf}
      ${LoopUntil} $1 >= 40
      ${If} $0 == 0
        SetErrorLevel 3
        Quit
      ${EndIf}
      ${Break}
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(AuRunning)" IDRETRY +3
      SetErrorLevel 3
      Quit
    ${EndIf}
  ${Loop}
  !ifndef BUILD_UNINSTALLER
    ; Keep ownership outside the keys deleted by the stock old-version
    ; uninstaller. Write only after final validation and process shutdown, and
    ; before installSection can uninstall/extract. A failed write aborts safely.
    Call AuRequireSafePath
    !insertmacro AuPrepareLegacyShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ClearErrors
    WriteRegStr HKCU "Software\${APP_GUID}-Recovery" PendingInstallLocation "$INSTDIR"
    IfErrors 0 +3
      SetErrorLevel 2
      Quit
  !endif
!macroend

!macro customWelcomePage

  Function AuStyle
    SetCtlColors $AuDialog 25332D F8FAF5
    CreateFont $AuTitleFont "Segoe UI" 20 600
    CreateFont $AuBodyFont "Segoe UI" 10 400
    SendMessage $AuDialog ${WM_SETFONT} $AuBodyFont 1
  FunctionEnd

  Function AuWelcomeCreate
    Call AuSelectRecoveryPath
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Aurelia" "${VERSION}"
    nsDialogs::Create 1018
    Pop $AuDialog
    Call AuStyle
    InitPluginsDir
    File /oname=$PLUGINSDIR\aurelia.ico "${PROJECT_DIR}\public\branding\aurelia.ico"
    ${NSD_CreateIcon} 139u 0u 22u 22u ""
    Pop $0
    ${NSD_SetIcon} $0 "$PLUGINSDIR\aurelia.ico" $1
    ${NSD_CreateLabel} 0 26u 100% 24u "$(AuWelcome)"
    Pop $0
    SetCtlColors $0 25332D F8FAF5
    SendMessage $0 ${WM_SETFONT} $AuTitleFont 1
    ${NSD_AddStyle} $0 ${SS_CENTER}
    ${NSD_CreateLabel} 0 52u 100% 14u "$(AuMotto)"
    Pop $0
    SetCtlColors $0 596B62 F8FAF5
    ${NSD_AddStyle} $0 ${SS_CENTER}
    ${NSD_CreateLabel} 0 72u 100% 12u "$(AuPath)"
    Pop $0
    SetCtlColors $0 596B62 F8FAF5
    ${NSD_CreateText} 0 86u 100% 18u "$INSTDIR"
    Pop $0
    SendMessage $0 ${EM_SETREADONLY} 1 0
    ${NSD_CreateButton} 30u 112u 115u 24u "$(AuInstall)"
    Pop $0
    ${NSD_OnClick} $0 AuQuickClick
    ${NSD_CreateButton} 155u 112u 115u 24u "$(AuCustom)"
    Pop $0
    ${NSD_OnClick} $0 AuCustomClick
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    nsDialogs::Show
  FunctionEnd

  Function AuQuickClick
    Pop $0
    StrCpy $AuMode "quick"
    Call AuValidatePath
    ${If} $AuValid == "1"
      SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(AuInvalid)"
    ${EndIf}
  FunctionEnd

  Function AuCustomClick
    Pop $0
    StrCpy $AuMode "custom"
    SendMessage $HWNDPARENT ${WM_COMMAND} 1 0
  FunctionEnd

  Function AuWelcomeLeave
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_SHOW}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_SHOW}
  FunctionEnd

  Function AuCustomCreate
    ${If} ${isUpdated}
    ${OrIf} $AuMode != "custom"
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$(AuCustom)" "$(AuChoose)"
    nsDialogs::Create 1018
    Pop $AuDialog
    Call AuStyle
    ${NSD_CreateLabel} 0 10u 100% 14u "$(AuPath)"
    Pop $0
    SetCtlColors $0 25332D F8FAF5
    ${NSD_CreateText} 0 28u 240u 22u "$INSTDIR"
    Pop $AuPathInput
    ${NSD_OnChange} $AuPathInput AuPathChanged
    ${If} $AuExisting != ""
      EnableWindow $AuPathInput 0
    ${EndIf}
    ${NSD_CreateButton} 246u 28u 54u 22u "$(AuBrowse)"
    Pop $0
    ${NSD_OnClick} $0 AuBrowseClick
    ${If} $AuExisting != ""
      EnableWindow $0 0
    ${EndIf}
    ${NSD_CreateLink} 0 57u 180u 14u "$(AuReset)"
    Pop $0
    SetCtlColors $0 285E46 F8FAF5
    ${NSD_OnClick} $0 AuResetClick
    ${If} $AuExisting != ""
      EnableWindow $0 0
    ${EndIf}
    ${NSD_CreateLabel} 0 76u 100% 18u ""
    Pop $AuSpaceLabel
    SetCtlColors $AuSpaceLabel 596B62 F8FAF5
    ${NSD_CreateCheckbox} 0 98u 100% 16u "$(AuShortcut)"
    Pop $AuCheckbox
    ${If} $AuDesktop == "1"
      ${NSD_Check} $AuCheckbox
    ${EndIf}
    SetCtlColors $AuCheckbox 25332D F8FAF5
    ${NSD_CreateLabel} 0 119u 100% 18u "$(AuData)"
    Pop $0
    SetCtlColors $0 596B62 F8FAF5
    Call AuRefreshSpace
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(AuBegin)"
    ShowWindow $0 ${SW_SHOW}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_SHOW}
    nsDialogs::Show
  FunctionEnd

  Function AuPathChanged
    Pop $0
    Call AuRefreshSpace
  FunctionEnd

  Function AuRefreshSpace
    ${NSD_GetText} $AuPathInput $0
    ${GetRoot} "$0" $1
    ${DriveSpace} "$1\" "/D=F /S=M" $AuAvailable
    SectionGetSize 0 $AuRequired
    IntOp $AuRequired $AuRequired / 1024
    ${NSD_SetText} $AuSpaceLabel "$(AuRequired)"
  FunctionEnd

  Function AuBrowseClick
    Pop $0
    ${If} $AuExisting != ""
      Return
    ${EndIf}
    ${NSD_GetText} $AuPathInput $0
    nsDialogs::SelectFolderDialog "$(AuPath)" "$0"
    Pop $0
    ${If} $0 != error
      ${NSD_SetText} $AuPathInput "$0"
    ${EndIf}
  FunctionEnd

  Function AuResetClick
    Pop $0
    ${NSD_SetText} $AuPathInput "$AuDefault"
  FunctionEnd

  Function AuCustomLeave
    ${NSD_GetText} $AuPathInput $INSTDIR
    ${NSD_GetState} $AuCheckbox $AuDesktop
    Call AuValidatePath
    ${If} $AuValid != "1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(AuInvalid)"
      Abort
    ${EndIf}
  FunctionEnd

  Function AuRequireSafePath
    Call AuValidatePath
    ${If} $AuValid != "1"
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$(AuInvalid)"
      SetErrorLevel 2
      Quit
    ${EndIf}
  FunctionEnd

  Function AuSelectRecoveryPath
    ; The stock mode page recalculates the default when its own registration is
    ; absent. Restore our durable recovery path, but reject a different explicit
    ; /D later rather than silently accepting a relocation.
    ${If} $AuRecovering == "1"
      !insertmacro GetDParameter $R0
      ${If} $R0 == ""
        StrCpy $INSTDIR "$AuExisting"
      ${EndIf}
    ${EndIf}
  FunctionEnd

  Function AuValidatePath
    StrCpy $AuValid "0"
    Call AuSelectRecoveryPath
    ; Only absolute local drive paths are accepted.
    StrCpy $0 "$INSTDIR" 2 1
    ${If} $0 != ":\"
      Return
    ${EndIf}
    ; NSIS GetFullPathName fails for a not-yet-created directory. Normalize
    ; with the Windows API first, before creating anything in the target.
    System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r1, p 0)i.r2'
    ${If} $2 == 0
    ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
      Return
    ${EndIf}
    StrCpy $INSTDIR "$1"
    Call AuValidateUninstallRegistration
    ${If} $AuRegistrationSafe != 1
      Return
    ${EndIf}
    ; Protect the first upgrade from an older, unguarded uninstaller as well.
    Call AuValidateTree
    ${If} $AuTreeSafe != 1
      Return
    ${EndIf}
    ; A malformed/mismatched record never grants ownership. All ordinary path
    ; guards below still run before any partial installation is repaired.
    ${If} $AuRecoveryPath != ""
      System::Call 'kernel32::GetFullPathNameW(w "$AuRecoveryPath", i ${NSIS_MAX_STRLEN}, w .r4, p 0)i.r2'
      ${If} $2 == 0
      ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
        StrCpy $AuRecoveryPath ""
      ${Else}
        StrCpy $AuRecoveryPath "$4"
      ${EndIf}
    ${EndIf}
    ; A registered application is updated in place. Reject both interactive
    ; relocation and a different /D override before touching either directory.
    ${If} $AuExisting != ""
      System::Call 'kernel32::GetFullPathNameW(w "$AuExisting", i ${NSIS_MAX_STRLEN}, w .r4, p 0)i.r2'
      ${If} $2 == 0
      ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
        Return
      ${EndIf}
      StrCpy $AuExisting "$4"
      ${If} $AuExisting != "$INSTDIR"
        Return
      ${EndIf}
    ${EndIf}
    ${GetRoot} "$INSTDIR" $0
    ; A drive letter can be a mapped network share. Accept only local fixed or
    ; removable drives, rejecting remote, unavailable, optical and unknown types.
    System::Call 'kernel32::GetDriveTypeW(w "$0\")i.r4'
    ${If} $4 != 2
    ${AndIf} $4 != 3
      Return
    ${EndIf}
    ${If} $INSTDIR == "$0\"
    ${OrIf} $INSTDIR == "$WINDIR"
    ${OrIf} $INSTDIR == "$SYSDIR"
    ${OrIf} $INSTDIR == "$PROGRAMFILES"
    ${OrIf} $INSTDIR == "$PROGRAMFILES64"
    ${OrIf} $INSTDIR == "$LOCALAPPDATA"
    ${OrIf} $INSTDIR == "$APPDATA"
    ${OrIf} $INSTDIR == "$PROFILE"
    ${OrIf} $INSTDIR == "$DESKTOP"
      Return
    ${EndIf}
    ; Reject junctions/symlinks at any existing ancestor.
    StrCpy $2 "$INSTDIR"
    ${Do}
      ${If} $2 == "$WINDIR"
      ${OrIf} $2 == "$PROGRAMFILES"
      ${OrIf} $2 == "$PROGRAMFILES64"
        Return
      ${EndIf}
      System::Call 'kernel32::GetFileAttributesW(w r2)i.r3'
      ${If} $3 != -1
        IntOp $3 $3 & 0x400
        ${If} $3 != 0
          Return
        ${EndIf}
      ${EndIf}
      ${GetParent} "$2" $3
      ${If} $3 == ""
      ${OrIf} $3 == "$2"
        ${Break}
      ${EndIf}
      StrCpy $2 "$3"
    ${Loop}
    ; Only registered ownership or the exact trusted pending path may contain
    ; application files. No unrelated nonempty directory can be adopted.
    ${If} $AuExisting != "$INSTDIR"
      FindFirst $2 $3 "$INSTDIR\*.*"
      ${DoWhile} $3 != ""
        ${If} $3 != "."
        ${AndIf} $3 != ".."
          FindClose $2
          Return
        ${EndIf}
        FindNext $2 $3
      ${Loop}
      FindClose $2
    ${Else}
      ${IfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
        ${If} $AuRecoveryPath != "$INSTDIR"
          Return
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${DriveSpace} "$0\" "/D=F /S=K" $2
    SectionGetSize 0 $3
    ${If} $2 < $3
      IfSilent +2
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(AuSpace)"
      Return
    ${EndIf}
    ; A temporary file proves writability without touching existing files.
    ClearErrors
    CreateDirectory "$INSTDIR"
    GetTempFileName $2 "$INSTDIR"
    ${If} ${Errors}
      Return
    ${EndIf}
    Delete "$2"
    StrCpy $AuValid "1"
  FunctionEnd
!macroend

!macro customPageAfterChangeDir
  Page custom AuWelcomeCreate AuWelcomeLeave
  Page custom AuCustomCreate AuCustomLeave
!macroend

!macro customInstall
  Push "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Call AuShortcutOwnership
  Pop $0
  ${If} $AuDesktop == "1"
    ${If} $0 != 2
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}
  ${ElseIf} $0 == 1
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}
  Push "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Call AuShortcutOwnership
  Pop $0
  ${If} $0 == 1
    WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" AureliaDesktopShortcut 1
  ${Else}
    WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" AureliaDesktopShortcut 0
  ${EndIf}
  ; Extraction, stock registration and shortcut work succeeded. Recovery is
  ; no longer pending; stock uninstall deliberately never clears this key.
  DeleteRegKey HKCU "Software\${APP_GUID}-Recovery"
!macroend

!macro customUnInstall
  ; Recheck after an interactive confirmation delay, before ANY removal.
  Call un.AuRequireSafeTree
  ${IfNot} ${isKeepShortcuts}
    Push "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Call un.AuShortcutOwnership
    Pop $0
    ${If} $0 == 1
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInit
  Call un.AuRequireSafeTree
!macroend
