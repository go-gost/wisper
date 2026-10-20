; Tauri NSIS hooks for Wisper (wired via bundle.windows.nsis.installerHooks).
;
; Wisper.exe spawns the Go backend as a sidecar, wisper-api.exe. A sidecar is a
; child process, so it survives when the installer's built-in Restart Manager
; check shuts down Wisper.exe only. The surviving sidecar keeps
; "$INSTDIR\wisper-api.exe" locked, the file copy in Section Install fails with
; "Error opening file for writing", and the upgrade aborts.
;
; Kill the sidecar before the install/uninstall sections copy or delete files.
; Matching by image name also cleans up an orphan whose parent app already died
; (crash, Task Manager), where the Restart Manager check finds nothing to close.

!macro WisperStopSidecar
  DetailPrint "Stopping the Wisper background service (wisper-api.exe)..."
  ; nsExec keeps the taskkill console hidden. taskkill exits with 128 ("process
  ; not found") when the sidecar was not running, which is fine here.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM wisper-api.exe'
  Pop $0
  ; Give Windows a moment to release the image file lock before overwriting it.
  Sleep 300
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro WisperStopSidecar
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro WisperStopSidecar
!macroend
