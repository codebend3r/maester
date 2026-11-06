#!/usr/bin/env bash
# Installs CI's pinned ffmpeg and ffprobe into /usr/local/bin on Linux, x86_64 or arm64, checked
# by digest. The one pin for the ✅ Checks job (pull-request-checks.yml) and its local image
# (ci.Dockerfile, run by ci_docker.sh), so both encode raven's test clips and cues alike; Ubuntu's
# own 6.1 drifts enough to fail the picture subtitle burn test. Run it as root.
#
# A month-end build, kept for two years; BtbN's daily builds expire after 14 builds.
set -euo pipefail

RELEASE=autobuild-2026-09-30-13-08
VERSION=n9.0.2-17-g2a571b6068

case "$(uname -m)" in
  x86_64)
    target=linux64
    digest=68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269
    ;;
  aarch64 | arm64)
    target=linuxarm64
    digest=91afcd7695d4bbbb9e0057aa10baaf9875ec4e1a97303f9059ec971336a2ab46
    ;;
  *)
    echo "No pinned ffmpeg for $(uname -m)" >&2
    exit 1
    ;;
esac

build="ffmpeg-$VERSION-$target-gpl-9.0"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/$build.tar.xz" \
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/$RELEASE/$build.tar.xz"
echo "$digest  $work/$build.tar.xz" | sha256sum -c -
tar -xf "$work/$build.tar.xz" -C "$work"
install -m 755 "$work/$build/bin/ffmpeg" "$work/$build/bin/ffprobe" /usr/local/bin/
ffmpeg -version | head -n 1
