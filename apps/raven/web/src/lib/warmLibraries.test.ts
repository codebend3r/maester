import { describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { warmLibraries } from '@/lib/warmLibraries'
import { library, mediaItem } from '@/test/fixtures'

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })

describe('warmLibraries', () => {
  it('reads each library in turn, waiting for idle before every one', async () => {
    const events: string[] = []
    const media = spyOn(api, 'listMedia').mockImplementation(async ({ libraryId }) => {
      events.push(`read ${libraryId}`)
      return [mediaItem({ libraryId })]
    })
    const shows = spyOn(api, 'listShows').mockImplementation(async ({ libraryId }) => {
      events.push(`shows ${libraryId}`)
      return { shows: [], unmatched: [] }
    })
    await warmLibraries({
      queryClient: client(),
      libraries: [
        library({ id: 1 }),
        library({ id: 2, settings: { ...library().settings, kind: 'shows' } }),
        library({ id: 3 }),
      ],
      signal: new AbortController().signal,
      wait: async () => {
        events.push('idle')
      },
    })
    expect(events).toEqual(['idle', 'read 1', 'idle', 'shows 2', 'idle', 'read 3'])
    media.mockRestore()
    shows.mockRestore()
  })

  it('leaves out locked libraries and random sorts, which nothing read ahead could match', async () => {
    const media = spyOn(api, 'listMedia').mockImplementation(async () => [])
    const base = library().settings
    await warmLibraries({
      queryClient: client(),
      libraries: [
        library({ id: 1, settings: { ...base, locked: true } }),
        library({ id: 2, settings: { ...base, sort: 'random' } }),
        library({ id: 3 }),
      ],
      signal: new AbortController().signal,
      wait: async () => {},
    })
    expect(media).toHaveBeenCalledTimes(1)
    expect(media.mock.calls[0]?.[0].libraryId).toBe(3)
    media.mockRestore()
  })

  it('does not ask again for a listing that is still fresh', async () => {
    const media = spyOn(api, 'listMedia').mockImplementation(async () => [])
    const queryClient = client()
    const options = {
      queryClient,
      libraries: [library({ id: 1 })],
      signal: new AbortController().signal,
      wait: async () => {},
    }
    await warmLibraries(options)
    await warmLibraries(options)
    expect(media).toHaveBeenCalledTimes(1)
    media.mockRestore()
  })

  it('stops between libraries once aborted', async () => {
    const media = spyOn(api, 'listMedia').mockImplementation(async () => [])
    const controller = new AbortController()
    await warmLibraries({
      queryClient: client(),
      libraries: [library({ id: 1 }), library({ id: 2 })],
      signal: controller.signal,
      wait: async () => controller.abort(),
    })
    expect(media).not.toHaveBeenCalled()
    media.mockRestore()
  })
})
