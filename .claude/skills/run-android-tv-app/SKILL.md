---
name: run-android-tv-app
description: Use when running raven's device app (`@raven/app`) on Android TV, a real Google TV Streamer or other Android TV over adb, or the `raven_tv` emulator: "run the app on my Google TV", "install raven on the Streamer", "sideload the APK", "run the Android TV e2e", "adb device offline", "failed to connect to 127.0.0.1", Maestro saying "0 devices connected" or "Device emulator-5554 was requested, but it is not connected", or the e2e flows stuck on "Sign in to raven" instead of the PIN screen.
---

# Run the Android TV app

`@raven/app` builds one APK per variant, all under one application id, `io.github.codebend3r.raven.app`, so installing one replaces whichever raven is on the device (`-r` keeps its servers and settings). Tools come from the `get-started` skill (Android Studio, SDK, `raven_tv` AVD, Maestro). iPhone, iPad and Apple TV are the `run-device-app` skill.

Every command below needs:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
ADB="$ANDROID_HOME/platform-tools/adb"
```

## 1. Pick the build

| For                                       | Build from the repo root                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A real TV, signing in at the public raven | `bun run app:build:android-tv`                                                                               |
| A real TV on a LAN server over plain http | `APP_VARIANT=development bun run app:build:android-tv`                                                       |
| The e2e flows (fixture server)            | `APP_VARIANT=development EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN=http://127.0.0.1:8490 bun run app:build:android-tv` |

For a sign-in that opens filled in, the user puts `EXPO_PUBLIC_RAVEN_TEST_EMAIL` and `EXPO_PUBLIC_RAVEN_TEST_PASSWORD` in the app's gitignored `apps/raven/app/.env.test-account` themselves; never ask for or type their password. Build it with `bun run build:android-tv:test-account` from `apps/raven/app`: only that script reads the file (Nx and Expo never load it), and it is no Nx target, so the APK, which then holds the password, is never cached locally or in Nx Cloud. Never share that APK.

The APK lands at `apps/raven/app/android/app/build/outputs/apk/release/app-release.apk`. A cold build takes about 20 minutes. Nx keys the cache on both variables, so switching between rows restores the right APK.

## 2a. A real TV (Google TV Streamer)

The home Google TV Streamer is `192.168.50.49`. Its MAC is randomized, so `arp -an` shows no Google prefix for it; don't go looking for it by vendor. It has no adb on port 5555; it uses Wireless debugging, whose port changes every time it is turned on, and the TV turns it off when it restarts or changes network. A device that adb lists as `offline`, or `failed to connect`, means Wireless debugging is off, its port moved, or the port is not adb at all.

macOS Local Network privacy blocks the SDK's `adb` from the LAN: `adb connect 192.168.50.49:<port>` fails with `No route to host` while Apple's `/usr/bin/nc` and `/usr/bin/python3` reach the same port. So adb talks to the TV through a loopback relay run by Apple's Python, and the TV shows up in `adb devices` as `127.0.0.1:15556`.

1. On the TV, once: Settings, System, About, press Android TV OS build seven times. Then Settings, System, Developer options, turn on Wireless debugging. The screen shows the TV's `IP address:port`.
2. Find the port without the screen: `dns-sd -B _adb-tls-connect._tcp local.` lists the TV's service while Wireless debugging is on (`$ADB mdns services` can come up empty), and `dns-sd -L <service name> _adb-tls-connect._tcp local.` gives its port. `dns-sd` never exits and holds its output back when piped, so in a script run it under `script -q /dev/null` and kill it after a few seconds; `timeout 4 dns-sd ... | awk` always prints nothing. Nothing listed means Wireless debugging is off; the TV's other open ports (found with `nc -z`) are TLS services that leave adb `offline`, so don't relay to them.
3. First make sure nothing already holds the relay port: `lsof -nP -iTCP:15556 -sTCP:LISTEN`. An old relay loop from an earlier session (an orphaned `zsh ./relay2.sh`, parent pid 1) keeps respawning `nc -l 127.0.0.1 15556` to a dead port, and adb then sits `offline` against the wrong port. Stop its parent shell, not just the `nc`. Then start the relay as its own background job and leave it running while you work on the TV. Apple's `/usr/bin/python3` reaches the LAN like `nc` does, and unlike an `nc` fifo loop it serves adb's reconnects. Don't start it with a `pkill -f` whose pattern appears in the same command line, or the job kills itself.

```bash
/usr/bin/python3 -I -c '
import socket, sys, threading
host, port = sys.argv[1], int(sys.argv[2])
def pipe(a, b):
    try:
        while d := a.recv(65536): b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 15556)); srv.listen(8)
while True:
    c, _ = srv.accept(); u = socket.create_connection((host, port), 10); u.settimeout(None)
    for a, b in ((c, u), (u, c)): threading.Thread(target=pipe, args=(a, b), daemon=True).start()
' 192.168.50.49 <port>
```

The TV is on Wi-Fi with slow round trips, so the 80 MB APK takes several minutes to install; run the install in the background.

4. Pair, once per computer, through a second relay to the pairing port (choose Pair device with pairing code on the TV): `$ADB pair 127.0.0.1:<relay port> <code>`. Then connect: `$ADB connect 127.0.0.1:15556`, which `adb devices -l` lists as `device ... model:Google_TV_Streamer device:kirkwood`.
5. Install and open, naming the device (the emulator may be attached too):

```bash
TV=127.0.0.1:15556
$ADB -s $TV install -r apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
$ADB -s $TV shell am start -W -n io.github.codebend3r.raven.app/.MainActivity
$ADB -s $TV shell dumpsys activity activities | grep -m1 topResumedActivity
```

When you stop for the day, `$ADB disconnect 127.0.0.1:15556` and stop the relay: a stale `offline` entry hides the emulator from Maestro (see below).

The last line names raven's `MainActivity` once it is in front. `monkey` with the leanback category can leave a launcher dialog on top instead.

## 2b. The emulator and the e2e flows

1. Boot `raven_tv` in a process of its own: `"$ANDROID_HOME/emulator/emulator" -avd raven_tv -no-window -noaudio -no-boot-anim -camera-back none`. Run it as its own background job; started inside a shell that is later stopped, the emulator shuts down with it. Wait for `$ADB -s emulator-5554 shell getprop sys.boot_completed` to print `1`.
2. Start the fixture server and wait for `raven fixture server ready`: `bunx nx run @raven/server:serve:fixture`. `EADDRINUSE 127.0.0.1:8490` means another one is running; walk its parents (`ps -o ppid= -p <pid>`) and stop it only when its root is orphaned (parent pid 1).
3. `$ADB -s emulator-5554 install -r <the e2e APK>`, then `bun run app:e2e:android-tv` (set `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000` on a cold emulator). It runs `adb reverse tcp:8490` first, so with several devices attached export `ANDROID_SERIAL=emulator-5554`.

## Common mistakes

| Symptom                                                                                                             | Cause                                                                               | Fix                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Maestro: `0 devices connected`, or `Device emulator-5554 was requested, but it is not connected` while adb lists it | An `offline` entry in `adb devices` hides every Android device from Maestro         | `$ADB disconnect <offline serial>`, run the flows, then `$ADB connect` it again |
| Every flow fails on a "Sign in to raven" screen instead of Home                                                     | The APK was built without `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN`                         | Rebuild with the e2e row of the table                                           |
| `adb: more than one device/emulator`                                                                                | The TV and the emulator are both attached                                           | `-s <serial>` on every adb call, `ANDROID_SERIAL` for the scripts               |
| `adb: device 'emulator-5554' not found` mid run                                                                     | The emulator exited with the shell that started it                                  | Restart it as its own background job                                            |
| The real TV never reaches a server and shows no sign-in                                                             | The e2e APK, which looks for `127.0.0.1:8490` on the TV itself, was installed on it | Rebuild without the variables and reinstall with `-r`                           |
