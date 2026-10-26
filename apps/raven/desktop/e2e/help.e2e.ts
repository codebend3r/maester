import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import {
  expectOffline,
  freshUserData,
  type MpvMode,
  readLog,
  removeDir,
  withApp,
} from '@/e2e/harness'
import { ENGINE_MODES } from '@/main/player/engine'

const COPIED_KEY = 'ravenE2eCopied'

type StubClipboardProps = { app: ElectronApplication }

/**
 * The system clipboard is the person's own, so the suite never touches it: main's
 * `clipboard.writeText` becomes a recorder. main looks it up at each call, so the
 * stand-in takes its place, and the stub fails loudly rather than let a write through.
 */
const stubClipboard = async ({ app }: StubClipboardProps): Promise<void> => {
  await app.evaluate(({ clipboard }, key) => {
    Reflect.set(globalThis, key, [])
    const record = async (...args: unknown[]) => {
      const [text] = args
      const copied: unknown = Reflect.get(globalThis, key)
      const earlier = Array.isArray(copied)
        ? copied.filter((item): item is string => typeof item === 'string')
        : []
      Reflect.set(globalThis, key, [...earlier, typeof text === 'string' ? text : ''])
    }
    const isSet = Reflect.set(clipboard, 'writeText', record)
    if (!isSet || Reflect.get(clipboard, 'writeText') !== record) {
      throw new Error('the clipboard could not be stubbed')
    }
  }, COPIED_KEY)
}

type CopiedTextsProps = { app: ElectronApplication }

/** What main wrote to the clipboard since `stubClipboard`, in order. */
const copiedTexts = async ({ app }: CopiedTextsProps): Promise<string[]> => {
  const copied = await app.evaluate((_modules, key) => {
    const value: unknown = Reflect.get(globalThis, key)
    return value
  }, COPIED_KEY)
  return Array.isArray(copied)
    ? copied.filter((item): item is string => typeof item === 'string')
    : []
}

type CopyDiagnosticsProps = { app: ElectronApplication }

const copyDiagnostics = async ({ app }: CopyDiagnosticsProps): Promise<void> => {
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('copy-diagnostics') ?? null
    if (item === null) throw new Error('no Copy Diagnostics item')
    item.click()
  })
}

type ReadyProps = { userData: string; page: Page }

type CopiedDiagnosticsProps = {
  mpv: MpvMode
  ready: (input: ReadyProps) => Promise<void>
}

/** Copies the diagnostics into the stand-in clipboard and answers what was copied. */
const copiedDiagnostics = async ({ mpv, ready }: CopiedDiagnosticsProps): Promise<string> => {
  const userData = await freshUserData()
  try {
    return await withApp({
      userData,
      mpv,
      run: async ({ app, page }) => {
        await expectOffline({ page })
        await ready({ userData, page })
        await stubClipboard({ app })
        await copyDiagnostics({ app })
        await expect(page.getByText('Copied the diagnostics.')).toBeVisible()
        const copied = await copiedTexts({ app })
        expect(copied).toHaveLength(1)
        return copied[0] ?? ''
      },
    })
  } finally {
    await removeDir(userData)
  }
}

// Show Logs and Show Crash Reports open Finder windows, so only their unit tests cover them.
test.describe('the Help menu', () => {
  test('copies diagnostics from the Help menu', async () => {
    const text = await copiedDiagnostics({
      mpv: ENGINE_MODES.headless,
      // Until the engine is open the diagnostics say it is still opening.
      ready: async ({ userData }) => {
        await expect
          .poll(async () =>
            (await readLog({ userData })).some((line) => line.includes('video engine ready: ')),
          )
          .toBe(true)
      },
    })
    expect(text.startsWith('Raven ')).toBe(true)
    expect(text).toContain('Video engine: mpv v0.')
    expect(text).toContain('hwdec=auto')
    expect(text).not.toContain('/')
  })

  test('copies diagnostics that say why the engine is unavailable', async () => {
    const text = await copiedDiagnostics({ mpv: ENGINE_MODES.off, ready: async () => undefined })
    expect(text.startsWith('Raven ')).toBe(true)
    expect(text).toContain('Video engine: unavailable (The video engine is off for this run.)')
  })
})
