import { expect, test } from '@playwright/test'
import { type Clips, makeClips } from '@/e2e/clips'
import { freshUserData, hasExited, removeDir, withApp } from '@/e2e/harness'
import { type HardenedElectron, hardenedElectron } from '@/e2e/hardenedRuntime'
import { expectClockAdvancing, expectPlayingNatively } from '@/e2e/playerView'
import { playDownload, seedDownloads } from '@/e2e/seedDownloads'

/*
 * mpv's built-in Lua scripts run through LuaJIT, which compiles a trace once a loop or a
 * callback turns hot; Raven 0.10.0, signed with the hardened runtime, was killed for it
 * ("Code Signature Invalid", an untagged executable page) about 15 seconds in.
 */
const PLAY_MS = 25_000
const TEST_TIMEOUT_MS = 120_000
const LABEL = 'Clip 01'
const MEDIA_ID = 1

test.describe('under the hardened runtime', () => {
  let userData = ''
  let clips: Clips = { folder: '', first: '', second: '' }
  let host: HardenedElectron = { folder: '', executable: '' }

  test.beforeAll(async () => {
    test.setTimeout(TEST_TIMEOUT_MS)
    const [data, made, hardened] = await Promise.all([
      freshUserData(),
      makeClips(),
      hardenedElectron(),
    ])
    userData = data
    clips = made
    host = hardened
    await seedDownloads({
      userData,
      clips: [{ path: clips.first, label: LABEL, mediaId: MEDIA_ID }],
    })
  })

  test.afterAll(async () => {
    await Promise.all([removeDir(userData), removeDir(clips.folder), removeDir(host.folder)])
  })

  test('plays through mpv without the kernel killing it', async () => {
    test.setTimeout(TEST_TIMEOUT_MS)
    await withApp({
      userData,
      executable: host.executable,
      run: async ({ app, page }) => {
        await playDownload({ page, label: LABEL })
        await expectPlayingNatively({ page, title: LABEL })
        await page.waitForTimeout(PLAY_MS)
        expect(hasExited(app)).toBe(false)
        await expectClockAdvancing(page)
      },
    })
  })
})
