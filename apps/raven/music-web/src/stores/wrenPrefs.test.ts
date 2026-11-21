import { describe, expect, it } from 'bun:test'
import { APPEARANCES, RECENT_SORTS, WREN_PREFS_KEY } from '@raven/wren'
import { DEFAULT_WREN_PREFS, followAppearance, useWrenPrefs } from '@/stores/wrenPrefs'

const INDEX_HTML = new URL('../../index.html', import.meta.url)

const keep = (state: unknown): void =>
  window.localStorage.setItem(WREN_PREFS_KEY, JSON.stringify({ state, version: 1 }))

const kept = (): unknown => JSON.parse(window.localStorage.getItem(WREN_PREFS_KEY) ?? 'null')

describe('useWrenPrefs', () => {
  it("starts on the system's appearance and Home's albums by when they were added", () => {
    expect(useWrenPrefs.getState()).toMatchObject({
      appearance: APPEARANCES.system,
      homeSort: RECENT_SORTS.added,
    })
  })

  it('keeps a change in this browser, under the key the apps use', () => {
    useWrenPrefs.getState().change({ appearance: APPEARANCES.light })

    expect(kept()).toMatchObject({
      state: { appearance: APPEARANCES.light, homeSort: RECENT_SORTS.added },
    })
  })

  it('reads back what it kept', async () => {
    keep({ appearance: APPEARANCES.dark, homeSort: RECENT_SORTS.release })
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject({
      appearance: APPEARANCES.dark,
      homeSort: RECENT_SORTS.release,
    })
  })

  it('guards each preference on its own, so one it does not know leaves the others kept', async () => {
    keep({ appearance: 'sepia', homeSort: RECENT_SORTS.release, downloadKbps: 320 })
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject({
      appearance: DEFAULT_WREN_PREFS.appearance,
      homeSort: RECENT_SORTS.release,
    })
    expect(useWrenPrefs.getState()).not.toHaveProperty('downloadKbps')
  })

  it('starts fresh from a value that is no object at all', async () => {
    window.localStorage.setItem(WREN_PREFS_KEY, '"nonsense"')
    await useWrenPrefs.persist.rehydrate()

    expect(useWrenPrefs.getState()).toMatchObject(DEFAULT_WREN_PREFS)
  })
})

describe('followAppearance', () => {
  it("wears Light or Dark as the page's theme, and none for System", () => {
    const stop = followAppearance()
    expect(document.documentElement.dataset.theme).toBeUndefined()

    useWrenPrefs.getState().change({ appearance: APPEARANCES.light })
    expect(document.documentElement.dataset.theme).toBe(APPEARANCES.light)

    useWrenPrefs.getState().change({ appearance: APPEARANCES.dark })
    expect(document.documentElement.dataset.theme).toBe(APPEARANCES.dark)

    useWrenPrefs.getState().change({ appearance: APPEARANCES.system })
    expect(document.documentElement.dataset.theme).toBeUndefined()
    stop()
  })

  it('is read by index.html before first paint, from the same key', async () => {
    const page = await Bun.file(INDEX_HTML).text()
    expect(page).toContain(`localStorage.getItem('${WREN_PREFS_KEY}')`)
    expect(page).toContain(
      `appearance === '${APPEARANCES.light}' || appearance === '${APPEARANCES.dark}'`,
    )
  })
})
