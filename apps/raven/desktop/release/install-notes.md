## Installing Raven

Raven runs on Macs with Apple Silicon.

1. Download `raven-player-<version>-arm64.dmg` (or the zip, `raven-player-<version>-arm64.zip`) and `SHA256SUMS` from the assets below.
2. Check the download in Terminal, in the folder you saved it to: `shasum -a 256 -c SHA256SUMS --ignore-missing`. Each file you downloaded should say `OK`.
3. Open the dmg and drag Raven to Applications (or unzip the zip and move Raven there).
4. The first time you open it, macOS says it cannot verify the app, because Raven is signed ad hoc rather than by an identified developer. Open System Settings, then Privacy & Security, and choose Open Anyway beside Raven; macOS asks you to confirm, then for an administrator's password. You only do this once.

The sources for libmpv and the libraries it is built from are in `raven-player-<version>-sources.tar.gz`, beside the app.

Raven checks for a newer release once a day. To stop it, turn off "Check for updates once a day" in Settings.
