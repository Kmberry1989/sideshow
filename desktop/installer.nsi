; Sideshow — Windows installer (NSIS).
; Built with the native Linux makensis (no Wine needed):
;   makensis installer.nsi
; Produces a self-contained setup .exe that installs the app from
; dist/win-unpacked, with Start Menu + Desktop shortcuts and an
; uninstaller. Per-user install (no admin / UAC prompt).
; The electron-builder config (package.json "build") is the canonical
; installer definition for a Windows build; this script is the
; Linux-built equivalent so a setup .exe can be produced here.

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Sideshow"
OutFile "dist/Sideshow Setup 0.1.11.exe"
InstallDir "$LOCALAPPDATA\Programs\Sideshow"
InstallDirRegKey HKCU "Software\Sideshow" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "assets/icon.ico"
!define MUI_UNICON "assets/icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Sideshow"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Sideshow.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Run Sideshow"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "dist/win-unpacked\*.*"
  WriteRegStr HKCU "Software\Sideshow" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow" "DisplayName" "Sideshow"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow" "DisplayIcon" "$INSTDIR\Sideshow.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow" "DisplayVersion" "0.1.11"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Sideshow"
  CreateShortcut "$SMPROGRAMS\Sideshow\Sideshow.lnk" "$INSTDIR\Sideshow.exe" "" "$INSTDIR\Sideshow.exe" 0
  CreateShortcut "$SMPROGRAMS\Sideshow\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Sideshow.lnk" "$INSTDIR\Sideshow.exe" "" "$INSTDIR\Sideshow.exe" 0
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Sideshow\Sideshow.lnk"
  Delete "$SMPROGRAMS\Sideshow\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Sideshow"
  Delete "$DESKTOP\Sideshow.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sideshow"
  DeleteRegKey HKCU "Software\Sideshow"
SectionEnd
