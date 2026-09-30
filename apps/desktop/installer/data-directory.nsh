!include nsDialogs.nsh
!include LogicLib.nsh
Var DataDirectory
Var DataInput
Var DataDialog
Var DataExisting

!macro customPageAfterChangeDir
  Page custom DataDirectoryPage DataDirectoryLeave
!macroend

Function DataDirectoryPage
  StrCpy $DataExisting "0"
  IfFileExists "$LOCALAPPDATA\HernessGUI-bootstrap\location.txt" existing
  IfFileExists "$LOCALAPPDATA\HernessGUI\*.*" existing
  Goto fresh
  existing:
    StrCpy $DataExisting "1"
  fresh:
  nsDialogs::Create 1018
  Pop $DataDialog
  ${NSD_CreateLabel} 0 0 100% 36u "User data location / 用户数据目录。升级保留现有目录，可在设置 > 关于中迁移。"
  Pop $0
  ${If} $DataExisting == "1"
    ${NSD_CreateLabel} 0 45u 100% 40u "Existing user data detected. Keep its location; use Settings to migrate safely."
    Pop $0
  ${Else}
    ${NSD_CreateDirRequest} 0 45u 78% 14u "$LOCALAPPDATA\HernessGUI-Data"
    Pop $DataInput
    ${NSD_CreateBrowseButton} 80% 45u 20% 14u "Browse…"
    Pop $0
    ${NSD_OnClick} $0 BrowseDataDirectory
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function BrowseDataDirectory
  nsDialogs::SelectFolderDialog "User data directory" "$LOCALAPPDATA"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $DataInput $0
  ${EndIf}
FunctionEnd

Function DataDirectoryLeave
  ${If} $DataExisting == "1"
    Return
  ${EndIf}
  ${NSD_GetText} $DataInput $DataDirectory
  ${If} $DataDirectory == ""
    MessageBox MB_OK "Choose a user data directory."
    Abort
  ${EndIf}
  ${If} $DataDirectory == $INSTDIR
    MessageBox MB_OK "User data must be outside the application directory."
    Abort
  ${EndIf}
  GetFullPathName $DataDirectory "$DataDirectory"
  StrLen $1 $INSTDIR
  StrCpy $2 $DataDirectory $1
  ${If} $2 == $INSTDIR
    MessageBox MB_OK "Choose a directory outside the application folder."
    Abort
  ${EndIf}
  StrLen $1 $DataDirectory
  ${If} $1 <= 3
    MessageBox MB_OK "Choose a subfolder, not the drive root."
    Abort
  ${EndIf}
  FindFirst $0 $1 "$DataDirectory\*.*"
  check_empty:
    ${If} $1 == ""
      Goto empty_ok
    ${EndIf}
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      MessageBox MB_OK "Please choose an empty directory."
      Abort
    ${EndIf}
    FindNext $0 $1
    Goto check_empty
  empty_ok:
  FindClose $0
  CreateDirectory "$DataDirectory"
  ClearErrors
  FileOpen $0 "$DataDirectory\.herness-write-test" w
  ${If} ${Errors}
    MessageBox MB_OK "Cannot write to the selected directory."
    Abort
  ${EndIf}
  FileClose $0
  Delete "$DataDirectory\.herness-write-test"
FunctionEnd

!macro customInstall
  ${If} $DataDirectory != ""
    CreateDirectory "$LOCALAPPDATA\HernessGUI-bootstrap"
    FileOpen $0 "$LOCALAPPDATA\HernessGUI-bootstrap\location.txt" w
    FileWriteUTF16LE /BOM $0 "$DataDirectory"
    FileClose $0
  ${EndIf}
!macroend
