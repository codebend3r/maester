import { createApiClient } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { LOCAL_ACCOUNT } from '@/browserDownloads/entries'
import { startBrowserDownloads } from '@/browserDownloads/start'
import { DOWNLOADS_HOSTS } from '@/downloads/host'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useDownloadsHostStore } from '@/stores/downloadsHost'
import { fakeStorage, storageOf } from '@/test/opfs'

const api = createApiClient({ fetch: async () => Response.json({}) })

type TargetProps = { isSecureContext?: boolean; canWrite?: boolean }

const targetOf = ({ isSecureContext = true, canWrite = true }: TargetProps = {}) => ({
  isSecureContext,
  navigator: { storage: storageOf(fakeStorage()) },
  FileSystemFileHandle: { prototype: canWrite ? { createWritable: () => undefined } : {} },
  fetch: async () => Response.json({}),
})

describe('startBrowserDownloads', () => {
  it("makes the browser's downloads the page's host where it can keep a video", async () => {
    startBrowserDownloads({ target: targetOf(), api, isDesktop: false })
    const { engine } = useBrowserDownloads.getState()
    expect(engine).not.toBeNull()
    expect(useDownloadsHostStore.getState().host?.kind ?? null).toBe(DOWNLOADS_HOSTS.browser)
    engine?.setAccount(LOCAL_ACCOUNT)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(engine?.isSettled() ?? null).toBe(true)
    expect(engine?.list() ?? null).toEqual([])
    expect((await engine?.space()) ?? null).toEqual({
      free: Number.POSITIVE_INFINITY,
      total: Number.POSITIVE_INFINITY,
      used: 0,
    })
  })

  it('does nothing inside Raven, whose main keeps the downloads', () => {
    startBrowserDownloads({ target: targetOf(), api, isDesktop: true })
    expect(useBrowserDownloads.getState().engine).toBeNull()
    expect(useDownloadsHostStore.getState().host).toBeNull()
  })

  it('does nothing in a browser that cannot keep a video', () => {
    startBrowserDownloads({ target: targetOf({ canWrite: false }), api, isDesktop: false })
    startBrowserDownloads({ target: targetOf({ isSecureContext: false }), api, isDesktop: false })
    expect(useBrowserDownloads.getState().engine).toBeNull()
    expect(useDownloadsHostStore.getState().host).toBeNull()
  })
})
