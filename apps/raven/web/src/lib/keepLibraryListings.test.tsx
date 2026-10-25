import { describe, expect, it, spyOn } from 'bun:test'
import { waitFor } from '@testing-library/react'
import { queryKeys } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { KeepLibraryListings } from '@/lib/keepLibraryListings'
import { listingStore } from '@/lib/listingStore'
import { fakeAccount, readyConfig } from '@/test/authClient'
import { library, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const listing = { libraryId: 1, search: '', sort: 'title', seed: 0 } as const

const stubs = () => ({
  read: spyOn(listingStore, 'read').mockResolvedValue(undefined),
  write: spyOn(listingStore, 'write').mockResolvedValue(undefined),
  media: spyOn(api, 'listMedia').mockResolvedValue([mediaItem({ libraryId: 1 })]),
})

const restoreAll = (spies: ReturnType<typeof stubs>) =>
  Object.values(spies).forEach((spy) => spy.mockRestore())

const render = (options: Partial<Parameters<typeof renderWithProviders>[0]>) =>
  renderWithProviders({
    ui: (
      <KeepLibraryListings>
        <p>The app</p>
      </KeepLibraryListings>
    ),
    libraries: [library({ id: 1 })],
    ...options,
  })

describe('KeepLibraryListings', () => {
  it('reads each library in the background once the viewer is served, and draws the app throughout', async () => {
    const spies = stubs()
    const { getByText, client } = render({})
    expect(getByText('The app')).toBeInTheDocument()
    await waitFor(() => expect(spies.media).toHaveBeenCalledTimes(1), { timeout: 4_000 })
    await waitFor(() => expect(client.getQueryData(queryKeys.media(listing))).toBeDefined())
    restoreAll(spies)
  })

  it('looks for the listings saved for the account that is signed in', async () => {
    const spies = stubs()
    render({ account: fakeAccount({ id: 'someone' }) })
    await waitFor(() => expect(spies.read).toHaveBeenCalledWith('someone'))
    restoreAll(spies)
  })

  it('waits while nobody is signed in', async () => {
    const spies = stubs()
    render({ authConfig: readyConfig })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(spies.read).not.toHaveBeenCalled()
    expect(spies.media).not.toHaveBeenCalled()
    restoreAll(spies)
  })
})
