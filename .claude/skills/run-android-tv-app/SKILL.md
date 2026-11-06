---
name: run-android-tv-app
description: >-
  Use when running raven's device app (`@raven/app`) on Android TV, a real Google TV Streamer or other Android TV over adb, or the `raven_tv` emulator: "run the app on my Google TV", "install raven on the Streamer", "sideload the APK", "run the Android TV e2e", "adb device offline", "failed to connect to 127.0.0.1", "debug the TV over Ethernet", "Wireless debugging will not turn on", Maestro saying "0 devices connected" or "Device emulator-5554 was requested, but it is not connected", or the e2e flows stuck on "Sign in to raven" instead of the PIN screen.
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

The home Google TV Streamer is on Ethernet at `192.168.50.62`. Never ask the user for its address, and never ask them to unplug the cable. Its Ethernet port and its Wi-Fi each have their own MAC (the Wi-Fi one randomized), so the address changes when it moves between them (`192.168.50.49` was its Wi-Fi address). Find it over mDNS instead of by vendor: `dns-sd -B _googlecast._tcp local.` lists `Google-TV-Streamer-<id>`, `dns-sd -L <that name> _googlecast._tcp local.` gives its `<uuid>.local.` host, and `dns-sd -G v4 <host>` gives the address. `dns-sd` never exits and holds its output back when piped, so in a script run it under `script -q /dev/null` and kill it after a few seconds; `timeout 4 dns-sd ... | awk` always prints nothing.

macOS Local Network privacy blocks the SDK's `adb` from the LAN: `adb connect <TV>:<port>` fails with `No route to host` while Apple's `/usr/bin/nc` and `/usr/bin/python3` reach the same port. So adb talks to the TV through a loopback relay run by Apple's Python, and the TV shows up in `adb devices` as `127.0.0.1:15556`.

How adb reaches the TV depends on its network:

| TV on    | Developer options switch | adb port                                | Pairing                           |
| -------- | ------------------------ | --------------------------------------- | --------------------------------- |
| Ethernet | USB debugging            | `5555`, plain adb                       | None; accept the prompt on the TV |
| Wi-Fi    | Wireless debugging       | Changes each time it is turned on (TLS) | Once per computer, with a code    |

On Ethernet, Wireless debugging refuses to turn on. USB debugging opens plain adb on `5555` over the network instead, with no cable to the Mac.

1. On the TV, once: Settings, System, About, press Android TV OS build seven times. Then Settings, System, Developer options:
   - On Ethernet, turn on USB debugging. Check it with `/usr/bin/nc -z -G 2 <TV> 5555`. Turning the switch off and on again restarts the TV's adb, so disconnect and connect again after it.
   - On Wi-Fi, turn on Wireless debugging. The screen shows the TV's `IP address:port`. To find the port without the screen, `dns-sd -B _adb-tls-connect._tcp local.` lists the TV's service while it is on (`$ADB mdns services` can come up empty), and `dns-sd -L <service name> _adb-tls-connect._tcp local.` gives its port. Nothing listed means it is off.

   The TV's other open ports (`6466`, `6467`, `8008`, `8009`, `8443`, `9000`, `10001` and a few high ones) are cast, remote and TLS services, not adb, and leave adb `offline`; don't relay to them. Both switches turn off when the TV restarts.

2. First make sure nothing already holds the relay port: `lsof -nP -iTCP:15556 -sTCP:LISTEN`. An old relay loop from an earlier session (an orphaned `zsh ./relay2.sh`, parent pid 1) keeps respawning `nc -l 127.0.0.1 15556` to a dead port, and adb then sits `offline` against the wrong port. Stop its parent shell, not just the `nc`. Then start the relay as its own background job (`run_in_background`), not inside a script that also installs: the relay dies when its parent job ends. Leave it running while you work on the TV. Apple's `/usr/bin/python3` reaches the LAN like `nc` does, and unlike an `nc` fifo loop it serves adb's reconnects. Don't start it with a `pkill -f` whose pattern appears in the same command line, or the job kills itself. On Ethernet the arguments are `192.168.50.62 5555`.

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
' <TV address> <port>
```

3. Connect: `$ADB connect 127.0.0.1:15556`.
   - On Ethernet, adb lists the TV as `offline` until the "Allow debugging?" prompt on the TV is accepted ("Always allow from this computer" keeps it accepted); poll `$ADB devices` until it says `device`.
   - On Wi-Fi, pair first, once per computer, through a second relay to the pairing port (open the Wireless debugging entry itself and choose Pair device with pairing code): `$ADB pair 127.0.0.1:<relay port> <code>`.

   `adb devices -l` then lists `device ... model:Google_TV_Streamer device:kirkwood`.

4. Install and open, naming the device (the emulator may be attached too). The 87 MB APK takes a few minutes on Ethernet and several on Wi-Fi, whose round trips are slow; run the install in the background.

```bash
TV=127.0.0.1:15556
$ADB -s $TV install -r apps/raven/app/android/app/build/outputs/apk/release/app-release.apk
$ADB -s $TV shell am start -W -n io.github.codebend3r.raven.app/.MainActivity
$ADB -s $TV shell dumpsys activity activities | grep -m1 topResumedActivity
```

The last line names raven's `MainActivity` once it is in front. `monkey` with the leanback category can leave a launcher dialog on top instead.

To see which server the app talks to, read its sockets: `pid=$($ADB -s $TV shell pidof io.github.codebend3r.raven.app)`, `uid=$($ADB -s $TV shell stat -c %u /proc/$pid)`, then `$ADB -s $TV shell "cat /proc/net/tcp /proc/net/tcp6" | awk -v u=$uid '$8==u {print $3}'`. Each remote is little-endian hex: `...A4F09326:20FB` is `38.147.240.164:8443`, which is what raven's public origin resolves to.

When you stop for the day, `$ADB disconnect 127.0.0.1:15556` and stop the relay: a stale `offline` entry hides the emulator from Maestro (see below).

## 2b. The emulator and the e2e flows

1. Boot `raven_tv` in a process of its own: `"$ANDROID_HOME/emulator/emulator" -avd raven_tv -no-window -noaudio -no-boot-anim -camera-back none`. Run it as its own background job; started inside a shell that is later stopped, the emulator shuts down with it. Wait for `$ADB -s emulator-5554 shell getprop sys.boot_completed` to print `1`.
2. Start the fixture server and wait for `raven fixture server ready`: `bunx nx run @raven/server:serve:fixture`. `EADDRINUSE 127.0.0.1:8490` means another one is running; walk its parents (`ps -o ppid= -p <pid>`) and stop it only when its root is orphaned (parent pid 1).
3. `$ADB -s emulator-5554 install -r <the e2e APK>`, then `bun run app:e2e:android-tv` (set `MAESTRO_DRIVER_STARTUP_TIMEOUT=300000` on a cold emulator). It runs `adb reverse tcp:8490` first, so with several devices attached export `ANDROID_SERIAL=emulator-5554`.

## Common mistakes

| Symptom                                                                                                             | Cause                                                                                    | Fix                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Maestro: `0 devices connected`, or `Device emulator-5554 was requested, but it is not connected` while adb lists it | An `offline` entry in `adb devices` hides every Android device from Maestro              | `$ADB disconnect <offline serial>`, run the flows, then `$ADB connect` it again |
| Every flow fails on a "Sign in to raven" screen instead of Home                                                     | The APK was built without `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN`                              | Rebuild with the e2e row of the table                                           |
| `adb: more than one device/emulator`                                                                                | The TV and the emulator are both attached                                                | `-s <serial>` on every adb call, `ANDROID_SERIAL` for the scripts               |
| `adb: device 'emulator-5554' not found` mid run                                                                     | The emulator exited with the shell that started it                                       | Restart it as its own background job                                            |
| The real TV never reaches a server and shows no sign-in                                                             | The e2e APK, which looks for `127.0.0.1:8490` on the TV itself, was installed on it      | Rebuild without the variables and reinstall with `-r`                           |
| Wireless debugging will not turn on, and the TV answers ping but lists no `_adb-tls-connect` service                | The TV is on Ethernet, where Wireless debugging is refused                               | Turn on USB debugging and relay to port `5555`                                  |
| The TV is `offline` right after `adb connect` on Ethernet                                                           | The "Allow debugging?" prompt is waiting, or USB debugging was toggled and adb restarted | Accept the prompt; after a toggle, `$ADB disconnect` and connect again          |
| `failed to connect to '127.0.0.1:15556': Connection refused`                                                        | No relay listens: it ran inside a job that has ended                                     | Start the relay again as its own background job                                 |
| The TV does not answer at `192.168.50.49`                                                                           | It moved to Ethernet, which has its own address                                          | Resolve it over mDNS (above); on Ethernet it is `192.168.50.62`                 |
