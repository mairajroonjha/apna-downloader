Var DeleteUserDataCheckbox

!macro customUnInstallPage
  nsDialogs::Create 1018
  Pop $R0

  ${If} $R0 == error
    Return
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "Uninstallation Cleanup Options:"
  Pop $R1

  ${NSD_CreateCheckbox} 0 25u 100% 15u "Delete all app settings, saved login sessions, and cached user data"
  Pop $DeleteUserDataCheckbox
  ${NSD_Check} $DeleteUserDataCheckbox

  nsDialogs::Show
!macroend

!macro customRemoveFiles
  ${If} $DeleteUserDataCheckbox != ""
    ${NSD_GetState} $DeleteUserDataCheckbox $R0
    ${If} $R0 == 1
      RMDir /r "$APPDATA\Apna Dowanloader"
      RMDir /r "$APPDATA\apna-downloader"
      RMDir /r "$LOCALAPPDATA\Apna Dowanloader"
      RMDir /r "$LOCALAPPDATA\apna-downloader"
      RMDir /r "$LOCALAPPDATA\apna-downloader-updater"
    ${EndIf}
  ${EndIf}
!macroend
