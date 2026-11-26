#!/usr/bin/env bash
# Draws Wren on TV's launcher pictures from the brand's SVGs in `../wren-app/assets/brand`, as
# every Wren icon is drawn: a Bark bird with a Night eye on the brand's Leaf.
#
#   assets/images/tv_banner.png      Android TV's launcher banner, 320 by 180 dp at xhdpi
#   assets/images/tv_apple/          the Apple TV icon's two parallax layers at each size Apple
#                                    asks (400 by 240, 800 by 480, 1280 by 768) and the Top Shelf
#                                    images (1920 and 2320 by 720, at 1x and 2x), and the
#                                    signed out Top Shelf's invitation (1940 by 692 and
#                                    3880 by 1384), the lockup over a line asking to sign in
#
# config-tv reads both from `app.config.ts`. Run it again after a change to the brand's files.
set -euo pipefail
cd "$(dirname "$0")/.."
BRAND=../wren-app/assets/brand
LEAF='#a8262f'
NIGHT='#15201e'
EYE_RED='#c41725'
BARK='#e6e1d6'
BODY_FONT=../wren-app/assets/fonts/InstrumentSans-Medium.ttf
OUT=assets/images/tv_apple
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# The icon's bird alone, its ground taken out, and the lockup with the icon's Night eye.
sed 's/<rect[^>]*><\/rect>//' "$BRAND/wren-icon.svg" >"$WORK/bird.svg"
sed "s/$EYE_RED/$NIGHT/g" "$BRAND/wren-lockup-on-dark.svg" >"$WORK/lockup.svg"

icon() {
  local name=$1 w=$2 h=$3
  local bird_h=$((h * 92 / 100))
  magick -size "${w}x${h}" "xc:${LEAF}" -depth 8 -strip "$OUT/${name}-back.png"
  magick -background none -density 600 "$WORK/bird.svg" -resize "x${bird_h}" "$WORK/bird.png"
  magick -size "${w}x${h}" xc:none "$WORK/bird.png" -gravity center -composite \
    -depth 8 -strip "$OUT/${name}-front.png"
}

lockup() {
  local file=$1 w=$2 h=$3 share=$4
  local lockup_h=$((h * share / 100))
  magick -background none -density 600 "$WORK/lockup.svg" -resize "x${lockup_h}" "$WORK/lockup.png"
  magick -size "${w}x${h}" "xc:${LEAF}" "$WORK/lockup.png" -gravity center -composite \
    -depth 8 -strip "$file"
}

invite() {
  local file=$1 w=$2 h=$3
  local lockup_h=$((h * 30 / 100)) line=$((h * 7 / 100)) gap=$((h * 6 / 100))
  magick -background none -density 600 "$WORK/lockup.svg" -resize "x${lockup_h}" "$WORK/lockup.png"
  magick -background none -fill "$BARK" -font "$BODY_FONT" -pointsize "$line" \
    label:'Sign in to hear the latest releases' "$WORK/line.png"
  magick "$WORK/lockup.png" \( -size "1x${gap}" xc:none \) "$WORK/line.png" -background none \
    -gravity center -append "$WORK/invite.png"
  magick -size "${w}x${h}" "xc:${LEAF}" "$WORK/invite.png" -gravity center -composite \
    -depth 8 -strip "$file"
}

icon icon-small 400 240
icon icon-small-2x 800 480
icon icon-large 1280 768
lockup "$OUT/top-shelf.png" 1920 720 34
lockup "$OUT/top-shelf-2x.png" 3840 1440 34
lockup "$OUT/top-shelf-wide.png" 2320 720 34
lockup "$OUT/top-shelf-wide-2x.png" 4640 1440 34
lockup assets/images/tv_banner.png 640 360 44
invite "$OUT/top-shelf-sign-in.png" 1940 692
invite "$OUT/top-shelf-sign-in-2x.png" 3880 1384
# The phone-sized icon Expo's own `icon` field asks for, which the TV launchers never show.
magick -background none -density 300 "$BRAND/wren-icon.svg" -resize 1024x1024 -depth 8 -strip \
  assets/images/icon.png
