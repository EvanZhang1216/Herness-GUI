Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUTPUT}"
!include "${__FILEDIR__}\..\installer\data-directory.nsh"

!macro CheckPath app data expected
  StrCpy $INSTDIR "${app}"
  StrCpy $DataDirectory "${data}"
  Call CheckDataDirectoryOverlap
  ${If} $DataOverlapsApplication != "${expected}"
    FileWrite $9 "Values: [$INSTDIR] / [$DataDirectory], result=$DataOverlapsApplication$\r$\n"
    FileWrite $9 "FAIL: ${app} / ${data}$\r$\n"
    FileClose $9
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

Section
  FileOpen $9 "${RESULT}" w
  !insertmacro CheckPath "D:\Hermes-GUI" "D:\Hermes-GUI-data" "0"
  !insertmacro CheckPath "D:\Herness-GUI" "D:\Herness-Data" "0"
  !insertmacro CheckPath "D:\Hermes-GUI\" "D:\Hermes-GUI-data\" "0"
  !insertmacro CheckPath "D:\Hermes-GUI" "D:\Hermes-GUI\..\Hermes-GUI-data" "0"
  !insertmacro CheckPath "D:\应用" "D:\应用数据" "0"
  FileWrite $9 "PASS: independent sibling directories accepted$\r$\n"
  !insertmacro CheckPath "D:\Hermes-GUI" "D:\Hermes-GUI" "1"
  !insertmacro CheckPath "D:\Hermes-GUI" "D:\Hermes-GUI\data" "1"
  !insertmacro CheckPath "D:\Hermes-GUI\" "d:\hermes-gui\data\" "1"
  !insertmacro CheckPath "D:\Hermes-GUI" "D:\Other\..\Hermes-GUI\data" "1"
  !insertmacro CheckPath "D:\" "D:\data" "1"
  FileWrite $9 "PASS: same directory and real descendants rejected$\r$\n"
  FileClose $9
SectionEnd
