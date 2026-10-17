# raven Verdigris

A visual redesign of the raven web client, from a design handoff named Verdigris: the same dark teal ground, Young Serif headings and Instrument Sans text, made editorial (large serif titles, hairline-ruled sections, a fanned poster hero on home), with redrawn icons, seven user themes, a phone tab bar, and three pages raven did not have: a theme picker, a Sign in page and a landing page. The handoff's mockups are HTML prototypes with placeholder data; the app keeps its own data, components and copy, and takes the look.

Decided with the user:

- **Sign in** is built as UI only, at `/sign-in`, outside the shell and linked from nowhere. raven has no accounts (the PIN and the admin lock are all it has), and rookery signs in with Plex, so there is nothing for the form to send yet. Its states (idle, Signing in, error) are real and tested; submitting calls nothing.
- **Landing** is a route in the web app, `/get`, full screen outside the shell like the player. No release publishes desktop installers yet, so its download buttons point at the GitHub releases page until one does.
- One PR, in logically grouped commits.
- No server or API changes. Where a mockup shows data raven does not have (a "New season" eyebrow, a director credit on a card), the page shows what raven has and drops the rest.

## Tokens and themes

The tokens keep their names. `--color-night` is still the page, `--color-bark` still the text, and so on; a theme redefines their values. The handoff's role names map onto them:

| Handoff | Token | Role |
| --- | --- | --- |
| `--bg` | `--color-night` | the page |
| `--surface` | `--color-canopy` | cards, panels |
| `--surface-hi` | `--color-canopy-hi` (new) | a card under the pointer |
| `--deep` | `--color-deep` (new) | inputs, wells |
| `--fg` | `--color-bark` | text |
| `--fg2` | `--color-birch` | body and secondary text |
| `--muted` | `--color-lichen` | meta text, labels |
| `--dim` | `--color-moss-line` | large numerals and disabled only, never body text |
| `--active` | `--color-moss` | a selected row, quiet buttons, chips |
| `--active-hi` | `--color-moss-hi` (new) | their hover |
| `--accent` | `--color-leaf` | the primary button, Play |
| `--accent-hi` | `--color-leaf-hi` (new) | its hover |
| `--on-accent` | `--color-on-leaf` (new) | text on the accent |
| `--progress` | `--color-leaf-bright` | progress bars and thin marks |
| `--glow` | `--glow` (new) | the opacity of a hero's colour wash |

Hairlines are `--color-line-faint`, `--color-line` and `--color-line-strong`: bark mixed at 6, 10 and 16% into transparent. The glass and haze tokens become mixes of the theme's own colours, so they follow it. What sits on a picture does not theme: text on artwork is `--color-on-picture` (`#f1ece2`), the scrim under it `--color-picture-scrim`, and the player keeps its dark chrome in every theme.

Seven themes, the values in the handoff's README: Verdigris (the default, on `:root`), Bronze, Nocturne, Oxblood, Patina (light), Mint (light) and High contrast. `libs/raven/ui/src/styles/themes.scss` declares each as `[data-theme='…']`, Verdigris included, so a theme preview can wear any theme by its attribute. `THEMES` in `@raven/ui` lists each one's id, name, note and tone (light or dark), and nothing else; the colours live only in SCSS. A test checks that every theme block declares the same tokens, and that Verdigris's block matches `:root`.

The choice lives in `localStorage['raven-theme']` as the bare id. An inline script in `index.html` applies it to `<html data-theme>` before first paint; `stores/theme.ts` reads and writes it, updates `<meta name="theme-color">`, and follows a change made in another tab through the `storage` event. A light theme sets `color-scheme: light` and swaps the logo for `raven-mark-on-light.svg`.

New scale steps from the handoff: `--space-10` (7rem), `--radius-lg` (14px), `--radius-xl` (20px), `--radius-pill`, `--font-size-2xl` (2.5rem), `--font-size-display` (home's featured title), `--line-display` (0.95), `--ease-spring`, `--ease-out` (cards), and shadows for a poster, a hero poster and a popover.

## Icons

Same names, same 24 grid, redrawn: a 1.6 stroke with round corners, a soft fill layer under the main shape at 20% (40% on the current page), and solid marks (sparks, hearts, notes, dots). Each icon is up to three paths: fill, stroke, marks. On hover of the control around it, it squashes and springs back, arrows nudge their way instead, marks spin in, and the tint doubles; none of it moves under `prefers-reduced-motion`.

## Shell

- Wide: the side menu, about 248px: logo, Home, Favourites, a Pinned heading over the pinned libraries, then Libraries and Settings at the foot, the version and the collapse toggle under a hairline.
- Medium, or collapsed with B: icons only, about 74px, names as tooltips.
- Narrow: no side menu; a fixed tab bar at the bottom (Home, Libraries, Favourites, Settings), and room under the page for it.
- The current row has the moss fill and bark text, and its icon's tint at 40%.
- The theme button, a 44px circle with a conic swatch of the theme's leaf, bark and moss, sits at the top right of every browsing page and opens the picker: a 360px popover listing the seven themes, each with a mini preview, its name and note, and a check on the current one.

## Pages

Each page keeps its data, behaviour and tests, and takes the handoff's layout:

- **Home**: a hero of the newest arrivals with backdrops, a large title, its line and Play beside a fanned stack of three posters, advancing every few seconds with previous and next and a count; then Continue watching as wide tiles with progress, then each pinned library's newest as a poster row. Search keeps its place in the header.
- **Movie, show, season, episode, saga**: a back pill to where it came from over a masked backdrop that fades into the page; the poster beside a large serif title, its credit line, the content rating box and facts, rating chips, then the actions (Play or Resume in the accent, the rest quiet). Below, the tagline and summary beside the file facts, then versions, cast and crew in a scroller with previous and next, reviews, and the TMDB credit.
- **Libraries**: a card per library with its type's icon, name, counts, folders in monospace and scan state; Pin, Scan and Edit at the right.
- **Library**: back pill, title and counts, History, Scan and Edit; tabs with counts and an accent underline; the toolbar's search, sort, filters and views.
- **History, Favourites, Person, Settings, 404**: page titles in the large serif with a hairline-ruled section heading under each part; History's Watched and All played as a segmented control; Favourites' kinds as pills; Settings' choices as radio cards; the 404's "4, a dashed poster with the mark, 4".
- **Player**: the top bar (back, title, what is playing and how), the scrubber with its chapter ticks, and the controls as pills over the picture.
- **Sign in** and **Landing**: new, as above.
- **Design**: shows the themes and the new tokens, read from the stylesheets as now.

Breakpoints reuse the thresholds already in use rather than the handoff's 720px and 1180px: the phone layout (tab bar, stacked headers) under `48rem`, the icons-only menu under `64rem`, and the smallest type steps under `30rem`. Every page still works at 320px wide, and every motion sits behind `prefers-reduced-motion: no-preference`.
