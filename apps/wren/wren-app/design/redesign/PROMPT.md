You are working in the maester repo, on the branch that is currently checked out. Do not create or switch branches.

Implement the Wren redesign from the handoff package at `<PATH_TO>/wren-redesign-handoff`. Read `README.md` first, then `specs/screens.md` and `specs/components.md`. Look at the PNGs in `reference/` for every screen you touch; the HTML files in `reference/html/` hold the exact markup, sizes and colours if a PNG is ambiguous.

1. Add the package to the repo at `apps/wren/design/redesign/` (or the Wren app's existing docs/design folder if it has one). Commit it on its own: `docs(wren): add redesign handoff`.
2. Explore the Wren app. Report which targets it ships to (Expo/React Native phone and tablet, web, Tauri), how it handles theming, navigation and fonts today, and list every existing screen mapped to the screen IDs in `specs/screens.md`. Stop and show me this report before changing UI code.
3. Theme foundation:
   - Add `tokens/theme.ts` (or translate `tokens.json` into whatever the app uses) as the single source for colour, type, radius, spacing and sizes. No hard-coded hex values in components.
   - Light and dark themes: follow the OS by default, add an Appearance setting (System, Light, Dark) in Settings and persist it.
   - Load Young Serif and Instrument Sans (400/500/600) from `brand/fonts/`. If the logo handoff already added them, reuse that.
4. Build the shared components from `specs/components.md` first (buttons, icon button, fields, search field, segmented control, chips, song/artist/navigation rows, grouped list, album tile, mini player, tab bar, bottom sheet, alert dialog, empty state, status chip, equalizer indicator). Use the existing icon library if it has equivalents, otherwise inline SVG icons with a 1.75 stroke.
5. Rebuild the screens in this order, committing after each group:
   - Shell: tab bar, mini player, tablet sidebar and player bar, tablet breakpoint (shortest side 744 or more), portrait icon rail.
   - Sign in (P01, P02, T01).
   - Home and Library (P03 to P09, T02, T03). Library becomes a category list with pushed screens.
   - Search (P10 to P12, T06).
   - Album, Artist, Track actions, Add to playlist (P13 to P16, T04, T05).
   - Now playing, Lyrics, Up next (P17 to P19, T07).
   - Settings and Remove all downloads (P20, P21, T08).
6. Keep all existing behaviour and data wiring. Where the design shows something the app can't support yet (recent searches, synced lyrics, follow artist, playlists), build the UI behind the existing data or leave a clearly marked TODO; do not invent backend endpoints. Use real cover art from the server; the abstract art in the mockups is placeholder.
7. Fix the specific issues listed in the README table (tab overflow, segmented overflow, "0 albums" counts).
8. Check both themes on a phone and a tablet simulator or emulator for every screen and compare against the PNGs. Run lint, type check and tests; fix what you broke.
9. Finish with a summary: screens done, components added, deviations from the design and why, and any TODOs.
