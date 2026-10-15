; Frozen 0.10.0 custom removal policy, used to exercise the FIRST upgrade from
; a vulnerable old uninstaller when stock NSIS omits --keep-shortcuts because
; the old application executable is missing. This intentionally lacks a target
; ownership check; the NEW installer must prevent its foreign-link deletion.
!macro LegacyCustomUnInstall ShortcutPath
  ReadRegDWORD $0 HKCU "${INSTALL_REGISTRY_KEY}" AureliaDesktopShortcut
  ${If} $0 == 1
    WinShell::UninstShortcut "${ShortcutPath}"
    Delete "${ShortcutPath}"
  ${EndIf}
!macroend
