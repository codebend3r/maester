#!/usr/bin/env bash
# Puts the APK `build:android-tv` made (the Nx target this one depends on) on the real Android TV
# and opens it, with nothing to do on the TV but accept its "Allow debugging?" prompt the first
# time: finds the TV over mDNS, relays adb to it through the loopback (`scripts/adb_relay.py`, or nc
# when Apple's python3 cannot reach the LAN, since Local Network privacy keeps the SDK's adb off it),
# waits for the TV to accept the connection, installs over the raven that is there (-r keeps its sign-in and
# settings), launches it and checks it is in front.
#
#   bun run app:deploy:android-tv            # from the repo root; the development variant
#   APP_VARIANT=production bun run app:deploy:android-tv
#   ANDROID_TV=192.168.50.62:5555 ...        # skip discovery; the port is 5555 unless given
#   ANDROID_TV_NAME=Google-TV-Streamer ...   # which cast name to look for when more than one TV
#
# The TV needs Developer options' USB debugging on (on Ethernet, where Wireless debugging will not
# turn on), which opens plain adb on 5555 over the network. The relay this script starts ends
# with it; one already listening on the relay port is used as it is and left running.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd ../../.. && pwd)"
source scripts/android_apk.sh

RELAY_PORT="${ADB_RELAY_PORT:-15556}"
SERIAL="127.0.0.1:$RELAY_PORT"
TV_NAME="${ANDROID_TV_NAME:-Google-TV-Streamer}"
ACCEPT_TIMEOUT=180

# dns-sd never exits and holds its output back when piped, so it runs under a pty for a moment.
mdns_zone() {
  local out
  out="$(mktemp)"
  script -q /dev/null dns-sd -Z _googlecast._tcp local. > "$out" 2>&1 &
  local pid=$!
  sleep 4
  kill "$pid" 2> /dev/null || true
  tr -d '\r' < "$out"
  rm -f "$out"
}

# The TV's address from its cast service: its SRV names the host, which the system resolver turns
# into the address the TV has on whichever port (Ethernet or Wi-Fi) it is on today.
find_tv() {
  local host
  host="$(mdns_zone | awk -v name="$TV_NAME" 'index($1, name) == 1 && $2 == "SRV" { print $6; exit }')"
  [ -n "$host" ] || return 1
  dscacheutil -q host -a name "${host%.}" | awk '$1 == "ip_address:" { print $2; exit }'
}

is_listening() { lsof -nP -iTCP:"$RELAY_PORT" -sTCP:LISTEN > /dev/null 2>&1; }

RELAY_PID=""
RELAY_FIFO=""
stop_relay() {
  [ -n "$RELAY_PID" ] || return 0
  "$ADB" disconnect "$SERIAL" > /dev/null 2>&1 || true
  pkill -P "$RELAY_PID" 2> /dev/null || true
  kill "$RELAY_PID" 2> /dev/null || true
  [ -z "$RELAY_FIFO" ] || rm -f "$RELAY_FIFO"
}
trap stop_relay EXIT

# Local Network privacy is granted per program, and Apple's python3 has lost it before (no route
# to the TV while /usr/bin/nc still reached it), so python3 relays only when it can reach the TV,
# and otherwise a loop of two nc's joined by a fifo does, one adb connection at a time.
start_relay() {
  if /usr/bin/python3 -I -c 'import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), 3).close()' "$1" "$2" > /dev/null 2>&1; then
    /usr/bin/python3 -I "$REPO/scripts/adb_relay.py" "$1" "$2" "$RELAY_PORT" &
    RELAY_PID=$!
    return
  fi
  say "Apple's python3 cannot reach the TV (Local Network privacy), so nc relays"
  RELAY_FIFO="$(mktemp -u)"
  mkfifo "$RELAY_FIFO"
  (
    while true; do
      /usr/bin/nc -l 127.0.0.1 "$RELAY_PORT" < "$RELAY_FIFO" | /usr/bin/nc "$1" "$2" > "$RELAY_FIFO"
    done
  ) &
  RELAY_PID=$!
}

require_apk_and_adb build:android-tv

if is_listening; then
  say "Using the relay already listening on $SERIAL"
else
  if [ -n "${ANDROID_TV:-}" ]; then
    TV_HOST="${ANDROID_TV%%:*}"
    TV_PORT="${ANDROID_TV#*:}"
    [ "$TV_PORT" != "$ANDROID_TV" ] || TV_PORT=5555
  else
    say "Looking for $TV_NAME over mDNS"
    TV_HOST="$(find_tv || true)"
    TV_PORT=5555
    [ -n "$TV_HOST" ] || { echo "No $TV_NAME on the network: is the TV on? Set ANDROID_TV=<address>[:port] to skip discovery." >&2; exit 1; }
  fi
  /usr/bin/nc -z -G 3 "$TV_HOST" "$TV_PORT" > /dev/null 2>&1 \
    || { echo "$TV_HOST does not answer on $TV_PORT: turn on USB debugging in the TV's Developer options (on Ethernet), or Wireless debugging and pass its port (on Wi-Fi)." >&2; exit 1; }
  say "Relaying $SERIAL to $TV_HOST:$TV_PORT"
  start_relay "$TV_HOST" "$TV_PORT"
  sleep 1
fi

say "Connecting adb"
"$ADB" connect "$SERIAL" > /dev/null
waited=0
until [ "$("$ADB" -s "$SERIAL" get-state 2> /dev/null || true)" = "device" ]; do
  if [ "$waited" -eq 0 ]; then
    echo "Waiting for the TV to accept the connection (accept \"Allow debugging?\" on the TV once)."
  fi
  if [ "$waited" -ge "$ACCEPT_TIMEOUT" ]; then
    echo "The TV did not accept the connection within $ACCEPT_TIMEOUT s. If USB debugging was just toggled, run this again." >&2
    exit 1
  fi
  sleep 3
  waited=$((waited + 3))
  # A relay whose TV restarted adb leaves adb `offline`; asking again picks the new adbd up.
  if [ $((waited % 30)) -eq 0 ]; then
    "$ADB" disconnect "$SERIAL" > /dev/null 2>&1 || true
    "$ADB" connect "$SERIAL" > /dev/null 2>&1 || true
  fi
done
"$ADB" -s "$SERIAL" devices -l | grep "$SERIAL" || true

# From here adb acts on the relayed TV alone, as the shared steps expect.
export ANDROID_SERIAL="$SERIAL"
install_apk

say "Launching"
# A TV asleep or in its screensaver keeps a launched app behind the dream; waking it first.
"$ADB" shell input keyevent KEYCODE_WAKEUP
sleep 1
launch_in_front "the Android TV"
