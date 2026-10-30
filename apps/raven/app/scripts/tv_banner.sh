#!/usr/bin/env bash
# Draws the Android TV launcher banner at every density from the web's vector mark and the
# app's own serif, so no launcher upscales a small picture: 320 by 180 dp, as Android asks, at
# mdpi, hdpi, xhdpi, xxhdpi and xxxhdpi. `assets/images/tv_banner.png` is the xhdpi one, which
# config-tv needs named; `withTvBannerDensities` puts the rest in their density folders.
set -euo pipefail
cd "$(dirname "$0")/.."
MARK=../web/public/brand/raven-mark-on-dark.svg
FONT=assets/fonts/YoungSerif.ttf
GROUND='#15201e'
BARK='#e6e1d6'
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
draw() {
  local density=$1 scale=$2
  local w=$((320 * scale / 100)) h=$((180 * scale / 100))
  local mark_h=$((h * 58 / 100)) point=$((h * 24 / 100)) left=$((w * 11 / 100)) gap=$((w * 4 / 100))
  # The mark and the wordmark are drawn apart: `-size` and `-density` are settings that would
  # otherwise reach the SVG and the label and stretch them to the canvas.
  magick -background none -density 600 "$MARK" -resize "x${mark_h}" "$WORK/mark.png"
  magick -background none -fill "$BARK" -font "$FONT" -pointsize "$point" label:Raven "$WORK/word.png"
  local mark_w
  mark_w=$(magick "$WORK/mark.png" -format '%w' info:)
  magick -size "${w}x${h}" "xc:${GROUND}" \
    "$WORK/mark.png" -gravity west -geometry "+${left}+0" -composite \
    "$WORK/word.png" -gravity west -geometry "+$((left + mark_w + gap))+0" -composite \
    -depth 8 -strip "assets/images/tv_banner/${density}.png"
}
draw mdpi 100
draw hdpi 150
draw xhdpi 200
draw xxhdpi 300
draw xxxhdpi 400
cp assets/images/tv_banner/xhdpi.png assets/images/tv_banner.png
