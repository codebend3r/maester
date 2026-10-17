import { describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, type MatchItemType, type MediaItem } from '@raven/core'
import { useState } from 'react'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { api } from '@/lib/api'
import { itemDetails, itemSummary, matchedMovie, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

/** The card owns the open state so a right click can open the menu too. */
const Harness = ({
  media,
  matchType = null,
}: {
  media: MediaItem
  matchType?: MatchItemType | null
}) => {
  const [open, setOpen] = useState(false)
  return <MediaMenu media={media} open={open} onOpenChange={setOpen} matchType={matchType} />
}

const openMenu = () =>
  userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))

describe('MediaMenu', () => {
  it('marks a favourite through the API and closes', async () => {
    const calls: unknown[] = []
    const spy = spyOn(api, 'setFavourite').mockImplementation(async (input) => {
      calls.push(input)
      return mediaItem({ favourite: input.favourite })
    })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Favourite' }))
    spy.mockRestore()
    expect(calls).toEqual([{ id: 7, favourite: true }])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('asks before deleting, then deletes', async () => {
    const deleted: number[] = []
    const spy = spyOn(api, 'deleteMedia').mockImplementation(async (id) => {
      deleted.push(id)
    })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(deleted).toEqual([])
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Busboys (2026)?')
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    spy.mockRestore()
    expect(deleted).toEqual([7])
  })

  it('keeps the video when the confirmation is cancelled', async () => {
    const deleted: number[] = []
    const spy = spyOn(api, 'deleteMedia').mockImplementation(async (id) => {
      deleted.push(id)
    })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    spy.mockRestore()
    expect(deleted).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers Mark as watched for an unwatched card and sends a media target', async () => {
    const calls: unknown[] = []
    const spy = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as watched' }))
    spy.mockRestore()
    expect(calls).toEqual([{ watched: true, targets: [{ kind: 'media', id: 7 }] }])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers Mark as unwatched for a watched card and sends the other way', async () => {
    const calls: unknown[] = []
    const spy = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    renderWithProviders({ ui: <Harness media={mediaItem({ watched: true })} /> })
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Mark as watched' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as unwatched' }))
    spy.mockRestore()
    expect(calls).toEqual([{ watched: false, targets: [{ kind: 'media', id: 7 }] }])
  })

  it('offers Favourite and Mark as watched, and nothing else, while the admin lock is on', async () => {
    const location = spyOn(api, 'getMediaLocation')
    renderWithProviders({
      ui: <Harness media={matchedMovie()} matchType="movie" />,
      adminLock: { state: 'on', available: true },
    })
    await userEvent.click(screen.getByRole('button', { name: /^Options for / }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Favourite',
      'Mark as watched',
    ])
    expect(location).not.toHaveBeenCalled()
    location.mockRestore()
  })

  it("shows the server's reason when the file cannot be deleted", async () => {
    const reason = 'Could not delete the file: its folder is mounted read-only.'
    const spy = spyOn(api, 'deleteMedia').mockImplementation(async () => {
      throw new ApiError({ status: 500, message: reason })
    })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    spy.mockRestore()
  })

  describe('Edit images', () => {
    const spies = {
      item: spyOn(api, 'getItem'),
      images: spyOn(api, 'getItemImages'),
      libraries: spyOn(api, 'listLibraries'),
    }
    const asked: number[] = []

    const serve = () => {
      asked.length = 0
      spies.item.mockImplementation(async (id) => {
        asked.push(id)
        return itemDetails({ id })
      })
      spies.images.mockImplementation(async () => ({ poster: [], backdrop: [], logo: [] }))
      spies.libraries.mockImplementation(async () => [])
    }

    const openAny = () => userEvent.click(screen.getByRole('button', { name: /^Options for / }))

    it("opens a movie's pictures in a dialog over the page, and closes on Done", async () => {
      serve()
      renderWithProviders({ ui: <Harness media={matchedMovie()} /> })
      await openAny()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Edit images' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit images' })
      expect(
        await within(dialog).findByRole('heading', { name: 'Edit images' }),
      ).toBeInTheDocument()
      expect(asked).toEqual([40])
      await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('dialog', { name: 'Edit images' })).toBeNull()
    })

    it("edits an episode's show's pictures", async () => {
      serve()
      const episode = mediaItem({
        title: 'Severance - S01E01',
        match: 'matched',
        item: itemSummary({ id: 91, type: 'episode', show: { id: 90, title: 'Severance' } }),
      })
      renderWithProviders({ ui: <Harness media={episode} /> })
      await openAny()
      await userEvent.click(screen.getByRole('menuitem', { name: 'Edit images' }))
      await screen.findByRole('dialog', { name: 'Edit images' })
      expect(asked).toEqual([90])
    })

    it('is not offered for a file matched to nothing', async () => {
      renderWithProviders({ ui: <Harness media={mediaItem()} /> })
      await openAny()
      expect(screen.queryByRole('menuitem', { name: 'Edit images' })).toBeNull()
    })
  })

  it('closes with Escape and hands focus back to its button', async () => {
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Options for Busboys (2026)' }),
    )
  })

  it('shows where the file lives, and copies the path', async () => {
    const path = '/media/Movies/Busboys (2026) 1080p WEBRip.mkv'
    const asked: number[] = []
    const copied: string[] = []
    const location = spyOn(api, 'getMediaLocation').mockImplementation(async (id) => {
      asked.push(id)
      return { path }
    })
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copied.push(text)
    })
    // As raven is over HTTPS or on localhost, where the Clipboard API is allowed.
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    renderWithProviders({ ui: <Harness media={mediaItem()} /> })
    await openMenu()
    const item = await screen.findByRole('menuitem', { name: /Copy file path/ })
    expect(await within(item).findByText(path)).toBeInTheDocument()
    await userEvent.click(item)
    location.mockRestore()
    clipboard.mockRestore()
    Reflect.deleteProperty(window, 'isSecureContext')
    expect(asked).toEqual([7])
    expect(copied).toEqual([path])
    expect(screen.getByRole('menuitem', { name: /Copied/ })).toBeInTheDocument()
  })
})
