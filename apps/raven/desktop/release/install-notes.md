## Installing Raven

Raven runs on Macs with Apple Silicon and on 64-bit Windows.

### macOS

1. Download `raven-player-<version>-arm64.dmg` (or the zip, `raven-player-<version>-arm64.zip`) and `SHA256SUMS` from the assets below.
2. Check the download in Terminal, in the folder you saved it to: `shasum -a 256 -c SHA256SUMS --ignore-missing`. Each file you downloaded should say `OK`.
3. Open the dmg and drag Raven to Applications (or unzip the zip and move Raven there).
4. The first time you open it, macOS says it cannot verify the app, because Raven is signed ad hoc rather than by an identified developer. Open System Settings, then Privacy & Security, and choose Open Anyway beside Raven; macOS asks you to confirm, then for an administrator's password. You only do this once.

### Windows

1. Download `raven-player-<version>-x64-setup.exe` (or the zip, `raven-player-<version>-x64.zip`) and `SHA256SUMS` from the assets below.
2. Check the download in PowerShell, in the folder you saved it to: `Get-FileHash raven-player-<version>-x64-setup.exe -Algorithm SHA256`. The digest should match the line for that file in `SHA256SUMS`.
3. Run the setup exe. Raven installs for your account, needs no administrator, and adds a Start menu shortcut. Or unzip the zip anywhere and run `Raven.exe`; nothing is installed.
4. The installer is unsigned, so Windows SmartScreen warns that it protected your PC. Choose More info, then Run anyway. You only do this once.

### Sources

On macOS, the sources for libmpv and the libraries it is built from are in `raven-player-<version>-sources.tar.gz`, beside the app. On Windows, Raven ships the prebuilt `libmpv-2.dll` of one release of [mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), the one `libs/raven/mpv/native/windows.lock.json` names at this tag; that project builds it from the upstream sources, and each release lists them.

Raven checks for a newer release once a day. To stop it, turn off "Check for updates once a day" in Settings.
