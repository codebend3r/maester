# PR screenshots

Every PR that changes something a user sees gets screenshots of each changed screen and state (menu open, dialog open, each view). They go in that project's `###` section of the body.

The repo is public. Screenshots show a demo library of generated clips, never a real library: real titles, thumbnails, paths and usernames stay out.

## 1. Demo media (raven)

Put the clips in a real folder with a neutral path, such as `/Users/Shared/raven-demo/Movies` and `/Users/Shared/raven-demo/Clips`. The folder picker and the Libraries page print paths, and `BROWSE_ROOT` resolves symlinks, so a symlink into the scratchpad leaks the scratchpad path.

Name clips after open movies (`Big Buck Bunny (2008).mp4`, `Sintel (2010).mkv`, `Tears of Steel (2012).mkv`). Vary what the change shows:

- picture: `lavfi` sources `gradients`, `smptehdbars`, `testsrc2`, `mandelbrot`, `life`, `colorspectrum`, `sierpinski`, `zoneplate`, `cellauto`, `rgbtestsrc`
- resolution 480p to 4K, video H.264, HEVC (`-tag:v hvc1`) and AV1, length and size
- audio: AAC plays directly; AC-3 or E-AC-3 shows "Converted on the server"

Pass the length as `-t <seconds>`; several sources reject `:duration=`.

```sh
ffmpeg -y -f lavfi -i "gradients=s=1920x1080:speed=0.02:r=24" -f lavfi -i "sine=frequency=330" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -t 20 "/Users/Shared/raven-demo/Movies/Big Buck Bunny (2008).mp4"
```

For the player, one MKV with English AC-3, a Japanese AAC track titled `Commentary` and an English SRT: copy the mapping from `encodeRichClip` in `apps/raven/server/src/test/clips.ts`.

## 2. A separate server

The dev server (`8484`) and its data stay untouched. Build the web app into the scratchpad and let a second server serve it:

```sh
# in apps/raven/web
bunx vite build --outDir <scratch>/web --emptyOutDir
# in apps/raven/server, in the background
PORT=8585 HOST=127.0.0.1 DATA_DIR=<scratch>/data WEB_DIR=<scratch>/web \
  BROWSE_ROOT=/Users/Shared/raven-demo SCAN_ON_START=false ./node_modules/.bin/tsx src/main.ts
```

Set up state through the API rather than clicks:

- `POST /api/libraries` with `{ name, paths, settings: { kind } }` adds and scans a library
- `POST /api/media/:id/plays` then `PUT /api/media/:id/progress` with `{ position }` fills history and progress bars
- `PUT /api/libraries/:id` with `{ name, paths, settings: { view, sort } }` switches the view between shots

## 3. Capture

`bun add playwright-core` in the scratchpad, then launch Google Chrome (it plays H.264 and AAC; Playwright's Chromium doesn't):

```ts
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
await page.goto('http://localhost:8585/libraries/1')
await page.waitForLoadState('networkidle')
await page.evaluate(() =>
  Promise.all([...document.images].map((img) => img.decode().catch(() => null))),
)
await page.screenshot({ path: '<scratch>/shots/library-grid.png' })
```

Open every image before uploading. Retake any that shows a scratchpad path, a home folder, a username or real media.

Video frames compress badly as PNG; convert them: `sips -s format jpeg -s formatOptions 82 player.png --out player.jpg`. Keep UI-only shots as PNG.

## 4. Host on `pr-screenshots`

Images live on the orphan `pr-screenshots` branch, one folder per PR, never on the PR branch. It shares no history with `main`: never merge or rebase it.

A detached worktree leaves no local `pr-screenshots` branch behind for the branch sync and rebase skills to pick up:

```sh
git fetch origin pr-screenshots
git worktree add --detach <scratch>/pr-screenshots origin/pr-screenshots
mkdir -p <scratch>/pr-screenshots/pr-<n>
cp <scratch>/shots/* <scratch>/pr-screenshots/pr-<n>/
git -C <scratch>/pr-screenshots add -A
git -C <scratch>/pr-screenshots commit -m "MAE: screenshots for PR #<n>"
git -C <scratch>/pr-screenshots push origin HEAD:pr-screenshots
git worktree remove <scratch>/pr-screenshots
```

Lefthook prints "No config files … have been found" on that commit; the branch has no `lefthook.yml`, so that is expected.

Check each link serves an image: `curl -sI https://raw.githubusercontent.com/codebend3r/maester/pr-screenshots/pr-<n>/<name>.png` gives `200` and `content-type: image/png`.

## 5. Embed

A two-column table in the project's section, a bold caption row above each row of images, alt text on each, and one line saying where they came from:

```markdown
| Player                                                                                                         | Player settings                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ![Player with subtitles](https://raw.githubusercontent.com/codebend3r/maester/pr-screenshots/pr-96/player.jpg) | ![Player settings menu](https://raw.githubusercontent.com/codebend3r/maester/pr-screenshots/pr-96/player-settings.jpg) |
| **History**                                                                                                    | **`/design`**                                                                                                          |
| ![History page](https://raw.githubusercontent.com/codebend3r/maester/pr-screenshots/pr-96/history.png)         | ![Design page](https://raw.githubusercontent.com/codebend3r/maester/pr-screenshots/pr-96/design.png)                   |

Screenshots come from a demo library of generated clips, in Chrome at 1440x900.
```

## 6. Clean up

Stop the demo server, then delete `/Users/Shared/raven-demo` and the scratchpad data.
