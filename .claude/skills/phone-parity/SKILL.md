---
name: phone-parity
description: Use when raven's web app on a phone should look and behave like the device app on an iPhone or an Android phone, or to audit and fix the drift between them: "phone parity", "run the phone parity skill", "the web app on mobile looks terrible", "make mobile web match the iOS app", "mobile web vs the iPhone app", "check the phone layouts match", "parity between mobile web and the phone apps", or after a change to a touch layout in `apps/raven/app` or to a page of `apps/raven/web` at phone width.
---

# Phone parity: the web on a phone, iPhone and Android phone

Three surfaces show raven to someone holding a phone, and they should be one app:

| Surface        | Where                                                                                     | Role                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| iPhone         | `apps/raven/app`, the touch layouts (`src/layouts/*.touch.tsx`, `Touch*.tsx`, `Card.tsx`) | **The reference.** What the phone app draws is what the other two draw                         |
| Android phone  | the same touch layouts, `PLATFORM_TRAITS`' Android ecosystem (`src/platform/platform.ts`) | Shares every layout with the iPhone; only its sheets (`DrawnSheet.touch.tsx`) and fonts differ |
| Web on a phone | `apps/raven/web` at 320 to 480 px wide (`@media (max-width: 30rem)` and `40rem`)          | Brought to the iPhone's look, flows and words                                                  |

The iPhone app is the reference unless the user names another. A gap where the web on a phone has something the phone app lacks is reported, and ported to the app only when the user asked for both directions. Tablets, TVs and the desktop are out of scope: `parity-monitor` covers every surface, `wren-parity` covers Wren.

This skill finds the gaps and fixes them. Run it in report-only mode when the user asks only for an audit.

## 0. Read the rules first

Root `CLAUDE.md` (TypeScript, code style, React and CSS rules: grid only, no flex, no margins, tokens only, `as const` copy, `@/` imports, no dead CSS), `apps/raven/CLAUDE.md` and `apps/raven/app/CLAUDE.md`, above all "Touch navigation", "Every toolbar chip wears an icon", the item page and Continue watching bullets. A difference one of them states is intended: report it as `intended` with the line, and leave it.

## 1. Inventory the screens

List every screen a phone reaches, from the app's routes (`apps/raven/app/app/`) and the web's (`apps/raven/web/src` router, `pages/`). For each, name the app screen (`src/screens/*.tsx`) and its touch layout, and the web page and its SCSS module. At least:

- the shell: the app's `TouchTabs` (Home, Libraries, Favourites, Continue watching, More) and `TouchMoreSheet` against the web's phone bar and menu; `TouchNav` (Back, Home, theme swap, Home's `TouchSearchBar`) against the web's header
- Home: Binge, the hero (`HomeHero.touch`), Continue watching as resume cards, the library shelves
- a library (`Grid.touch`): toolbar chips as icons, the grid's columns per view, panels for a TV library's grid view, the jump strip, buckets
- an item page (`ItemLayout.touch`): backdrop fade, poster, actions row as icons with words, the ways up at its right, seasons and episodes, cast
- Search, Favourites, Continue watching, Binge, Coming soon, Libraries, Settings, Downloads
- music: album, artist, playlist, Now Playing and the bar (`NowPlayingBar`, `NowPlayingStrip.touch`)
- the player's touch chrome against the web player at phone width
- sign-in and the locked library's pad

## 2. Look at both, side by side

Read the code first, then confirm with screenshots; a screenshot alone misses states and a read alone misses what CSS does.

- **Web.** Start it with the `run-raven-web` skill (`bun run dev:raven:vhagar` at home), then drive it with the Playwright MCP tools at 390 by 844 (an iPhone's viewport; check 320 wide too, since every page must work there): `browser_resize`, `browser_navigate`, `browser_take_screenshot`. Sign in as the user when the page asks; never type a password the user has not given.
- **iPhone.** Use the `run-device-app` skill (`bun run app:dev:ios` on `raven-phone`) or the `raven-app-simulators` skill, and `xcrun simctl io booted screenshot <scratchpad>/<screen>-ios.png`. Read the screenshots with the Read tool.
- **Android phone.** Only when an Android-only layout is involved (sheets, fonts): a phone AVD (`Pixel_7`) and `adb exec-out screencap -p`.
- Use the same library, title and theme on both. Save every screenshot in the session's scratchpad, named `<screen>-web.png` and `<screen>-ios.png`.

When no simulator or server can run (no Xcode runtime, Vhagar down), say so and fall back to reading the code alone, marking each verdict `from code`.

## 3. Write the ledger

One row per gap, in the scratchpad as `phone-parity-ledger.md`, so a long run survives a compacted context:

| Screen | What differs | Reference (app file:line) | Web (file:line) | Verdict | Fix |
| ------ | ------------ | ------------------------- | --------------- | ------- | --- |

Verdicts: `drift` (fix it), `intended` (cite the document), `web-only` (the web has it, the app does not: report), `not applicable` (say why). Judge what a person sees or does: layout and order, sizes and spacing, which controls show and as what (icon alone or icon and words), words and their case, empty and loading states, gestures, where a press goes. Ignore refactors that change none of those.

Rank the drift: navigation and layout breakage first (overflow, a page wider than the screen, unreachable controls), then layout, then controls, then words, then polish.

## 4. Fix the web

Change `apps/raven/web` (and `@raven/ui` for the shared player) to match the reference, worst first:

- Phone styles go under the existing desktop-first breakpoints, `@media (max-width: 40rem)` or `30rem`, inside the component's own `*.module.scss`. Reuse the thresholds already in use; invent none.
- Follow the CSS rules exactly: grid with `gap`, named areas, tokens from `libs/raven/ui/src/styles/globals.scss`, motion inside `prefers-reduced-motion: no-preference`, no dead selectors. gale refuses `display: flex` and margins.
- Copy goes in the page's or component's `copy.ts` as an `as const` value; the app's words are the reference, so reuse them exactly.
- When a gap is the same rule on both sides (a sort, a count, a label), move it to `@raven/core` or `@raven/ui/headless` and have both read it, rather than writing it twice.
- Touch the app only for a `web-only` gap the user asked to port, or when the app is plainly broken; then follow `apps/raven/app/CLAUDE.md`.
- Never edit files outside the gap's own components without saying why in the ledger.

After each fix, take the web screenshot again and compare it with the iPhone's. A fix is done when the two read as the same screen.

## 5. Verify

From the repo root:

```bash
bunx nx run-many -t lint:ts lint:css typecheck test -p @raven/web @raven/ui
bun run dead-css
bun run verify:push
```

Fix what they report. The web's `test` target fails under its coverage floors, so a new component gets a test (`*.test.tsx`, bun test with happy-dom). When an app file changed, also `bunx nx run-many -t typecheck test -p @raven/app` and `cd apps/raven/app && bun run test:screens`.

## 6. Report

Lead with what changed and what is left: the screens checked, each drift fixed (screen, what, files), each `web-only` and `intended` row, anything not verified on a device and why, and the check results. Link the before and after screenshots by their full scratchpad paths. Do not commit or push unless the user asks; follow the `commit-format` skill when they do.
