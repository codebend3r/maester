# Wren redesign handoff

Mobile and tablet redesign of Wren (Maester music player), dark and light themes, built on the Wren logo suite.

Design canvas: https://claude.ai/artifact/MShZMsP6qX3qxUow75P7me

## Contents

| Path | What |
|---|---|
| `PROMPT.md` | Instructions for Claude Code |
| `specs/screens.md` | Every screen, its contents and states (phone and tablet) |
| `specs/components.md` | Component specs: sizes, tokens, states, motion |
| `tokens/tokens.json` | Source of truth for colour, type, radius, spacing, sizes |
| `tokens/tokens.css` | CSS variables with `@font-face`, OS theme detection and `data-theme` override |
| `tokens/theme.ts` | Typed theme objects for React Native or CSS-in-JS |
| `brand/svg/`, `brand/fonts/` | Logo SVGs and fonts from the Wren logo handoff |
| `reference/phone/`, `reference/tablet/`, `reference/foundations/` | PNG renders at 2x, one per screen per theme (`-dark.png`, `-light.png`) |
| `reference/html/` | Standalone HTML for each screen with exact markup and inline styles. Open in a browser |

## Principles

1. **Two themes, one layout.** Every colour comes from a semantic token. Dark is the default; follow the OS setting with a manual override in Settings (System, Light, Dark).
2. **Serif for identity, sans for work.** Young Serif for page titles, album and artist names, empty-state headings and lyrics. Instrument Sans for everything else.
3. **Red means action or live.** Primary buttons, the active tab, links, progress and the now-playing state. Nothing decorative. The logo's eye red (#c41725) stays in the logo.
4. **The mark's equalizer bars are the now-playing indicator.**
5. **Nothing scrolls sideways that shouldn't.** Navigation and settings controls always fit the width.
6. **Accessible by default.** 44 minimum touch targets, text contrast 4.5:1 or better in both themes, labels on icon buttons, Dynamic Type / font scaling supported.

## Problems fixed from the current build

| Current | Redesign |
|---|---|
| Library tab strip overflows and clips ("ums", "Dc") | Library is a category list; each category is its own screen |
| Settings segmented controls overflow ("2" cut off) | Grouped cards; segments fit; storage limit is a picker row |
| Artists show "0 albums · 1 track" | Zero counts dropped |
| Home is a single shelf | Continue listening, shortcuts, Recently added |
| Search idle state is empty | Browse tiles and recent searches; results get filter chips and a top result |
| Empty states are a single grey line | Icon, heading, help text, action |
| Track menu and Add to playlist are flat button stacks | Bottom sheets with headers and grouped actions; create playlist inline |
| Now playing Lyrics/Queue toggle is cramped | Full player with a bottom bar for Lyrics, Output, Up next |
| Remove-all alert is a stock dialog | Branded alert that explains the consequence |
| Tablet is a stretched phone | Sidebar, persistent player bar, split layouts |
| No visual system | Tokens, type scale and components shared by every screen |
