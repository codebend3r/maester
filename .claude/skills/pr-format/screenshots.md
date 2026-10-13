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

## 4. Host under `refs/screenshots/pr-<n>`

Each PR's images live in a commit of their own, holding only `pr-<n>/<name>.png`, pushed to `refs/screenshots/pr-<n>` on origin. Never a branch, never the PR branch: nothing under `refs/heads` means GitHub's branch list, `git fetch` and the branch sync skills never see it, and the ref keeps the commit from being garbage collected. The body links to the images by that commit's SHA.

Build the commit with a throwaway index, no checkout. A retake builds on the PR's current commit, so unchanged shots carry over and the old SHA stays reachable for older revisions of the body:

```sh
n=<n>
export GIT_INDEX_FILE=<scratch>/screenshots.index
rm -f "$GIT_INDEX_FILE"
parent=$(git fetch -q origin "refs/screenshots/pr-$n" 2>/dev/null && git rev-parse FETCH_HEAD)
if [ -n "$parent" ]; then git read-tree "$parent"; fi
for f in <scratch>/shots/*; do
  git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),pr-$n/$(basename "$f")"
done
tree=$(git write-tree)
unset GIT_INDEX_FILE
if [ -n "$parent" ]; then
  commit=$(git commit-tree "$tree" -p "$parent" -m "MAE: screenshots for PR #$n")
else
  commit=$(git commit-tree "$tree" -m "MAE: screenshots for PR #$n")
fi
git push origin "${commit}:refs/screenshots/pr-$n"
echo "$commit"
```

- Keep `${commit}` in braces: zsh reads `$commit:r` as a filename modifier and mangles the refspec
- To drop a shot on a retake, `git update-index --force-remove "pr-$n/<name>.png"` before `git write-tree`
- A retake is a new commit: point every link in that PR at the new SHA

The links are `https://raw.githubusercontent.com/codebend3r/maester/<commit>/pr-<n>/<name>.png`, with the full 40-character SHA.

Raw can take a minute to serve a new commit, and it caches a `404` for a few minutes. Check each link with a fresh throwaway query string first, so an early `404` never lands on the real link: `curl -sI "<link>?v=$RANDOM"` gives `200` and `content-type: image/png`. Only then check the bare link and put it in the body.

## 5. Embed

A two-column table in the project's section, a bold caption row above each row of images, alt text on each, and one line saying where they came from:

```markdown
| Player                                                                                                                                   | Player settings                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![Player with subtitles](https://raw.githubusercontent.com/codebend3r/maester/06890e2978f8c93fbd7109c8b06396dbb1a6a6ad/pr-96/player.jpg) | ![Player settings menu](https://raw.githubusercontent.com/codebend3r/maester/06890e2978f8c93fbd7109c8b06396dbb1a6a6ad/pr-96/player-settings.jpg) |
| **History**                                                                                                                              | **`/design`**                                                                                                                                    |
| ![History page](https://raw.githubusercontent.com/codebend3r/maester/06890e2978f8c93fbd7109c8b06396dbb1a6a6ad/pr-96/history.png)         | ![Design page](https://raw.githubusercontent.com/codebend3r/maester/06890e2978f8c93fbd7109c8b06396dbb1a6a6ad/pr-96/design.png)                   |

Screenshots come from a demo library of generated clips, in Chrome at 1440x900.
```

## 6. Clean up

Stop the demo server, then delete `/Users/Shared/raven-demo` and the scratchpad data.
