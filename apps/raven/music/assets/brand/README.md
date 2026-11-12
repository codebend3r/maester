# Wren's brand

Wren's mark is a wren standing on its own feet, its long paddle tail raised behind, with an equalizer cut through its body and raven's red in the eye. It is raven's sibling: the same colours, the same Young Serif wordmark, the same eye.

The design canvas with every lockup, size and mockup: https://claude.ai/artifact/JkR1iy8vy78v2upJ5ykF6x

## Which file to use

| Where                                                                                | File                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The mark on a dark ground (Night, a dark theme, a photo's dark end)                  | `wren-mark-on-dark.svg`                                                                                                                            |
| The mark on a light ground                                                           | `wren-mark-on-light.svg`                                                                                                                           |
| One colour: print, engraving, a tint, anything that recolours the mark               | `wren-mark-mono.svg` (recolour its fill; the eye is a hole)                                                                                        |
| The mark drawn 48 px or smaller: tab bars, list rows, a favicon, a notification      | `wren-mark-small-on-dark.svg`, `wren-mark-small-on-light.svg`, `wren-mark-small-mono.svg`                                                          |
| A header, a sign-in screen, anywhere the name sits beside the mark                   | `wren-lockup-on-dark.svg`, `wren-lockup-on-light.svg`, `wren-lockup-mono.svg`                                                                      |
| A launch screen, an about page, anywhere the logo stands centred alone with its name | `wren-stacked-on-dark.svg`, `wren-stacked-on-light.svg`, `wren-stacked-mono.svg`                                                                   |
| The name alone, where the mark already shows nearby                                  | `wren-wordmark-on-dark.svg`, `wren-wordmark-on-light.svg`, `wren-wordmark-mono.svg`                                                                |
| The iPhone and iPad app icon                                                         | `../images/icon.png`, rendered from `wren-icon.svg`                                                                                                |
| The Android launcher icon and its themed layer                                       | `../images/adaptive-icon.png` and `../images/adaptive-icon-monochrome.png`, from `wren-adaptive-foreground.svg` and `wren-adaptive-monochrome.svg` |

`app.config.ts` names the three PNG files in `WREN_ICONS`, and `src/config/appConfig.test.ts` checks that they exist.

## Rules

- **Colours.** Night `#15201e`, Bark `#e6e1d6`, Ink `#131416`, Eye red `#c41725`, Leaf `#a8262f`, Paper `#f1ece2`. Bark on dark grounds, Ink on light ones. Red appears only in the eye; the one colour files have none.
- **The cutouts are holes.** The equalizer bars (and the eye, in the one colour files) are cut through the shape, so the ground shows through them. Never fill them in or put a backing shape behind the mark.
- **Centring.** The mark files' box is centred on the bird's visual weight, not on its outline: the round body outweighs the thin tail, so centred by its outline the bird looks pushed right. Centre the file's box and the bird sits dead centre. The lockups are boxed on the outline, so their spacing to the wordmark is measured from the beak.
- **Sizes.** The full mark from 64 px up, the small cut from 16 to 48 px (three wider bars, a bigger eye, heavier legs), the horizontal lockup from 24 px tall.
- **Clear space.** One tail width clear on every side.
- **Type.** The wordmark is Young Serif, outlined in these files, so it needs no font installed. Instrument Sans for everything else, as in raven.
- **Do not** redraw, stretch, rotate, outline or recolour the mark beyond these colours, add a branch or a shadow, or set the name in another face.

## Changing the mark

These SVGs are the source. A change to the mark is a change to every file here, and the PNG files are rendered again from their SVGs at 1024 px, for example with `magick -background none -density 72 wren-icon.svg -resize 1024x1024 ../images/icon.png`. A new icon needs a fresh prebuild before a build shows it.
