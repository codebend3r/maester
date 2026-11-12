import { describe, expect, it, mock } from 'bun:test'
import { CONTROLLER_CHANGE, keepOfflinePages, RESOURCE } from '@/browserDownloads/keepOffline'

const ORIGIN = 'https://raven.example'

type PageProps = { isControlled?: boolean }

const pageOf = ({ isControlled = true }: PageProps = {}) => {
  const listeners = new Map<string, () => void>()
  const fetch = mock(async (_url: string) => undefined)
  const workers = {
    ready: Promise.resolve(),
    controller: isControlled ? {} : null,
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener)
    },
  }
  const target = {
    navigator: { serviceWorker: workers },
    performance: {
      getEntriesByType: () =>
        [
          `${ORIGIN}/assets/index-abc.js`,
          `${ORIGIN}/assets/index-abc.js`,
          `${ORIGIN}/assets/index-def.css`,
          `${ORIGIN}/api/libraries`,
          'https://elsewhere.example/assets/x.js',
        ].map((name) => ({
          name,
          entryType: RESOURCE,
          startTime: 0,
          duration: 0,
          toJSON: () => name,
        })),
    },
    location: { origin: ORIGIN },
    fetch,
  }
  return { target, fetch, listeners }
}

describe('keepOfflinePages', () => {
  it('fetches again each build file the page loaded, once, and asks for the offline pages', async () => {
    const { target, fetch } = pageOf()
    const pages = [mock(async () => undefined), mock(async () => undefined)]
    await keepOfflinePages({ target, pages })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ORIGIN}/assets/index-abc.js`,
      `${ORIGIN}/assets/index-def.css`,
    ])
    pages.forEach((load) => expect(load).toHaveBeenCalledTimes(1))
  })

  it('waits for the worker to answer for the page before it fetches anything', async () => {
    const { target, fetch, listeners } = pageOf({ isControlled: false })
    const kept = keepOfflinePages({ target, pages: [] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fetch).not.toHaveBeenCalled()
    listeners.get(CONTROLLER_CHANGE)?.()
    await kept
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('goes on past a file or a page that fails', async () => {
    const { target, fetch } = pageOf()
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const page = mock(async () => undefined)
    const broken = async () => {
      throw new Error('The chunk is gone.')
    }
    await keepOfflinePages({ target, pages: [broken, page] })
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('does nothing where the browser has no service worker', async () => {
    const { target, fetch } = pageOf()
    const page = mock(async () => undefined)
    await keepOfflinePages({ target: { ...target, navigator: {} }, pages: [page] })
    expect(fetch).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })
})
