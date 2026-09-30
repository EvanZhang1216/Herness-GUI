!include nsDialogs.nsh
!include LogicLib.nsh
Var DataDirectory
Var DataInput
Var DataDialog
Var DataExisting
Var DataOverlapsApplication

; Compare complete directory components, never a bare text prefix.
Function CheckDataDirectoryOverlap
  Push $0
  Push $1
  Push $2
  ; NSIS GetFullPathName can fail for not-yet-created directories.
  ; $INSTDIR strips a drive root's trailing slash; restore its absolute meaning.
  StrCpy $0 $INSTDIR
  StrLen $2 $0
  ${If} $2 == 2
    StrCpy $2 $0 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\"
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r0, p 0) i .r2'
  StrCpy $DataOverlapsApplication "2"
  ${If} $2 > 0
  ${AndIf} $2 < ${NSIS_MAX_STRLEN}
    System::Call 'kernel32::GetFullPathNameW(w "$DataDirectory", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r2'
    ${If} $2 > 0
    ${AndIf} $2 < ${NSIS_MAX_STRLEN}
      StrCpy $DataDirectory $1
      StrCpy $DataOverlapsApplication "0"
      StrCpy $2 $0 1 -1
      ${If} $2 != "\"
        StrCpy $0 "$0\"
      ${EndIf}
      StrCpy $2 $1 1 -1
      ${If} $2 != "\"
        StrCpy $1 "$1\"
      ${EndIf}
      StrLen $2 $0
      StrCpy $1 $1 $2
      ${If} $0 == $1
        StrCpy $DataOverlapsApplication "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

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
  ${NSD_CreateLabel} 0 0 100% 36u "请选择保存聊天记录和配置的用户数据目录。升级保留现有目录，可在设置 > 关于中迁移。"
  Pop $0
  ${If} $DataExisting == "1"
    ${NSD_CreateLabel} 0 45u 100% 40u "检测到已有用户数据，将保留其位置。安装后可在设置中安全迁移。"
    Pop $0
  ${Else}
    ${NSD_CreateDirRequest} 0 45u 78% 14u "$LOCALAPPDATA\HernessGUI-Data"
    Pop $DataInput
    ${NSD_CreateBrowseButton} 80% 45u 20% 14u "浏览…"
    Pop $0
    ${NSD_OnClick} $0 BrowseDataDirectory
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function BrowseDataDirectory
  nsDialogs::SelectFolderDialog "选择用户数据目录" "$LOCALAPPDATA"
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
    MessageBox MB_OK "请选择用户数据目录。"
    Abort
  ${EndIf}
  Call CheckDataDirectoryOverlap
  ${If} $DataOverlapsApplication == "2"
    MessageBox MB_OK "无法识别所选路径，路径可能过长，请选择其他文件夹。"
    Abort
  ${EndIf}
  ${If} $DataOverlapsApplication == "1"
    MessageBox MB_OK "用户数据目录不能与程序安装目录相同，也不能放在其内部。$\r$\n$\r$\n程序目录：$INSTDIR$\r$\n数据目录：$DataDirectory$\r$\n$\r$\n可以选择同级目录，例如 D:\Hermes-GUI-data。"
    Abort
  ${EndIf}
  StrLen $1 $DataDirectory
  ${If} $1 <= 3
    MessageBox MB_OK "请选择一个文件夹，不能直接使用磁盘根目录。"
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
      MessageBox MB_OK "请选择一个空文件夹作为用户数据目录。"
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
    MessageBox MB_OK "无法写入所选目录，请检查权限或选择其他文件夹。"
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
