# Components

All sizes in px (pt on iOS, dp on Android). Colours are token names from `tokens/`. Every interactive element has a hit area of at least 44 x 44.

## Buttons

| Variant | Fill | Text | Border | Use |
|---|---|---|---|---|
| Primary | `accent` | `accentInk` | none | Play, Sign in, Resume, New playlist, destructive confirm |
| Secondary | `surface2` | `text` | none | Shuffle, Cancel, Clear search |
| Ghost | transparent | `text` | 1px `line2` | Sign out, Follow |
| Danger (row) | transparent | `accentText` | none | Remove all downloads |

- Height 48 (52 for Sign in), fully rounded (`radius.pill`), padding 0 20, label `type.button`, optional 18px leading icon with an 8px gap.
- Play and Shuffle sit side by side at equal width (`flex: 1`) with a 10px gap.
- Pressed: 0.85 opacity. Disabled: 0.4 opacity. Loading: replace label with a spinner, keep width.

## Icon button
Circle, 44 default (36 to 56 by context), icon 18 to 26. Always has an accessible label. Variants: plain, filled `surface2`, outlined 1px `line2`.

## Text field
- Label above (`meta`, 600, `text2`), 8px gap.
- Box 52 tall, `radius.md`, 1px `line2`, fill `field`, leading 20px icon in `text3`, input 16px.
- Optional trailing icon button (show password).
- Error: border `accentText`, message below with alert icon, 13px `accentText`.
- Focus: 2px ring `accentText`.

## Search field
46 tall (42 inside lists), `radius.md` (12 inside lists), fill `surface2`, no border, search icon in `text3`, placeholder "Artists, albums, songs". Focused: 2px ring `accentText`, a clear (x) button and a "Cancel" text link to the right.

## Segmented control
Track `surface2`, 3px padding, 2px gap, radius 12. Selected segment `raised` with a 1px shadow, 600 weight; others `text2`, 500. Equal-width columns. Must never scroll sideways: use fewer, shorter labels ("128", "256") instead.

## Filter chips
34 tall, pill. Selected: fill `text`, label `bg`. Unselected: 1px inset `line2`, label `text`.

## List rows

**Song row**: min height 60, padding 8 x gutter, 1px bottom `line`.
`[44 art | 24 track number | eq indicator]` 14px gap, title `rowTitle`, subtitle `meta` `text2`, optional downloaded check (16, `text3`), duration `tabular-nums` 14 `text3`, more button (dots, 36 x 44, `text3`).
Playing row: title in `accentText` and the number replaced by the equalizer indicator.

**Artist row**: 64 tall, 48 circular avatar (initial in Young Serif on the art colour until the server provides images), name + "7 albums · 114 tracks". Never print "0 albums"; omit the album count when it is zero.

**Navigation row** (Library categories, Settings): 56 tall, 22 icon in `accentText` (Library) or a 32 icon tile `surface2` (Settings), label 16/500 (17 in Library), trailing value `text3` and chevron.

## Grouped list (Settings)
Card `surface`, `radius.lg`, 1px `line` ring, rows divided by `line`. Group headings sit above: `overline`, `text3`, inset 24.

## Album tile
Square art `radius.sm`, 8px gap, title 14/600, subtitle 13 `text2`, both single line with ellipsis. Phone grid: 2 columns, 14 column gap, 18 to 20 row gap. Tablet: 5 to 6 columns, 18 gap. Horizontal shelves use 148 (phone) tiles with 14 gap.

## Mini player (phone)
Floating card: inset 10 from the screen edges, 8 above the tab bar, 60 tall, `radius.lg`, fill `raised`, `shadow` plus 1px `line` ring.
`[40 art r8] [title 15/600, artist 13 text2] [pause 44] [next 44]`, 2px progress line along the bottom edge in `accentText`. Tap opens Now Playing. Swipe up opens Now Playing, swipe down dismisses after confirmation if playback is stopped.

## Tab bar (phone)
84 tall including the home indicator inset, fill `bg`, 1px top `line`. Four items: Home, Library, Search, Settings. Item: 22 icon inside a 52 x 30 pill, 11px label, 4px gap. Active: pill `accentSoft`, icon `accentText` (stroke 2), label `text` 600. Inactive: `text3`.

## Tablet sidebar
256 wide, fill `surface`, 1px right `line`, horizontal lockup (34 tall) at top. Groups: Home and Search, then a "Library" overline with Playlists, Artists, Albums, Songs, Downloads. Items 42 tall, `radius` 12, 20 icon. Active: fill `accentSoft`, text `accentText` 600. Settings and a server status pill pinned to the bottom.

## Tablet player bar
Full width, 84 tall, fill `raised`, 1px top `line`. Three columns: now playing (52 art, title, artist · album, like), centre transport (shuffle, prev, 44 play/pause in `text` fill, next, repeat) with a scrubber underneath (420 wide), right side lyrics, up next, output.

## Now playing (phone)
Full-screen sheet over everything. Header: chevron-down (close), "Playing from album" overline + album name, more. Art 334 square `radius` 18 with a soft shadow. Title Young Serif 26, artist link 17 `text2`, like (filled heart `accentText`). Scrubber: 5 tall track `line2`, fill and 14px thumb in `text`, elapsed and remaining times 12 `tabular-nums`. Transport: shuffle 44, prev 56, play/pause 76 circle filled `text` with `bg` icon, next 56, repeat 44. Active shuffle/repeat in `accentText`, inactive `text3`. Bottom bar: Lyrics, Output pill ("raven · This iPhone"), Up next. The active one gets an `accentSoft` pill.

## Lyrics
Compact header (56 art, title, artist, like). Lines in Young Serif 27/35: sung lines `text3` at 55% opacity, current line `text`, upcoming `text2`. Auto-scroll keeps the current line about a third from the top. Tap a line to seek. Compact transport (64 play button) at the bottom. Empty state: "No lyrics for this song" in `text2`.

## Up next (queue)
Compact header, "Up next" (18/600) with "From <source> · N songs", shuffle and repeat toggles (40 circles). Rows 60 tall: 40 art, title, "Artist · 3:36", drag handle. Swipe left to remove. Reorder by long-press drag.

## Bottom sheet
Scrim `scrim`, sheet `surface`, top corners `radius.sheet`, grabber 40 x 5 `line2`. Header: art 52 + title + subtitle + close (36 circle `surface2`). Actions 52 tall, 22 icon, 16/500 label, separators between groups (queue actions / library actions / navigation). No "Cancel" button; dismiss via drag, scrim tap or close.

## Alert dialog
Centered card, inset 28, `radius.xl`, fill `surface`. Icon tile 48 `accentSoft`, title Young Serif 23, body 15/22 `text2`, two equal buttons: Cancel (secondary), destructive action (primary `accent`). Copy states the consequence and the recovery path.

## Empty state
Centered column: 76 to 84 icon tile (`surface`, 1px `line`, radius 24 to 26), Young Serif 24 title, 15/22 body `text2` (max about 300 wide), optional primary or secondary button.

## Status chip
Pill 32 to 34 tall, `surface` with 1px `line`, 7 to 8px dot in `ok` (connected) or `accentText` (unreachable), 13px `text2`.

## Now-playing indicator (equalizer)
Four bars from the logo's chest: heights 45%, 100%, 66%, 30%, width 3, gap 2, radius 2, colour `accentText`. Animate heights while playing (each bar on its own 0.8 to 1.2s loop), freeze when paused, respect reduce-motion by keeping it static.

## Album art placeholders
The mockups use abstract placeholder art. In the app, use real cover art from the server. Fallback when there is no cover: `surface2` square with a 40% size note icon in `text3`. Artist avatars fall back to their initial in Young Serif.

## Motion
- Push and pop: platform default.
- Sheets and Now Playing: spring from the bottom, 300 to 350ms.
- Mini player to Now Playing: shared-element transition on the art when supported.
- Respect reduce-motion everywhere.
