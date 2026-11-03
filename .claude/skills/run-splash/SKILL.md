---
name: run-splash
description: Use when running raven's splash page (`@raven/splash`, maester.netlify.app) locally to try a change in the browser: "run the splash page", "start the splash dev server", "preview the splash build", "open the releases page locally", "run the front door", or http://localhost:5190 not answering.
---

# Run the splash page

`@raven/splash` is a static Vite page with no React and no backend: `index.html` (download Raven or open the web app) and `releases/index.html` (every release). Nothing else needs to run. Its only network call is the browser fetching the GitHub releases API (`src/releases.ts`), so the download buttons and the releases list need internet and are subject to GitHub's unauthenticated rate limit.

The dev server takes port **5190** with `strictPort`, so a second start fails instead of moving to another port.

## Steps

Run from the repo root, with `run_in_background` and the log in the scratchpad. Probe with curl, never `lsof` (it hangs on this Mac's SMB volumes).

1. **See what already runs.**

   ```bash
   curl -s -m 2 -o /dev/null -w '%{http_code}\n' http://localhost:5190/
   ```

   `200` means a splash Vite is up. Check whose it is before reusing it: `pgrep -fl vite` shows the path, and a Vite from `.claude/worktrees/<name>` serves that worktree's code, not this checkout's.

2. **Dev server (hot reload).** Create the scratchpad folder first (`mkdir -p`); it may not exist yet. Then `bun run dev:raven:splash` (`@raven/splash:dev`). Read the log for the `Local:   http://localhost:5190/` line, then check `http://localhost:5190/` and `http://localhost:5190/releases/` both answer `200`.

3. **Or the production build.** To see what Netlify serves (hashed assets, both entry pages):

   ```bash
   bun run build:raven:splash
   bun run preview:raven:splash
   ```

   Vite preview defaults to http://localhost:4173. Build output goes to `apps/raven/splash/dist`.

4. **Report**: the URL, which checkout's code it serves, the PID started (`pgrep -fl vite`) and how to stop it (kill that PID). Never `pkill -f` a pattern; it takes the user's other servers and worktree Vites with it.

## Known limits

- **The port is fixed.** "Port 5190 is already in use" means another splash Vite holds it, often a worktree's. Stop that one or use its server.
- `netlify.toml`'s `/tv` redirect (to the Android TV APK) is Netlify only; neither the dev server nor `preview` follows it.
- Without internet, or after GitHub's rate limit, `fetchReleases` answers an empty list and the page renders without release data. That is not a bug in the change under test.
- Style changes live in `src/styles/`; the splash's global SCSS is outside `dead-css`. `bun run affected` runs its `lint:css`, `lint:ts`, `typecheck` and `test` (the releases parsing, `src/releases.test.ts`).
