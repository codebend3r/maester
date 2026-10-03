import { describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, type MediaItem } from '@weirwood/core'
import { useState } from 'react'
import { MediaMenu } from '@/components/MediaMenu/MediaMenu'
import { api } from '@/lib/api'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

/** The card owns the open state so a right click can open the menu too. */
const Harness = ({ media }: { media: MediaItem }) => {
  const [open, setOpen] = useState(false)
  return <MediaMenu media={media} open={open} onOpenChange={setOpen} />
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
    renderWithProviders(<Harness media={mediaItem()} />)
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
    renderWithProviders(<Harness media={mediaItem()} />)
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
    renderWithProviders(<Harness media={mediaItem()} />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    spy.mockRestore()
    expect(deleted).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("shows the server's reason when the file cannot be deleted", async () => {
    const reason = 'Could not delete the file: its folder is mounted read-only.'
    const spy = spyOn(api, 'deleteMedia').mockImplementation(async () => {
      throw new ApiError({ status: 500, message: reason })
    })
    renderWithProviders(<Harness media={mediaItem()} />)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('closes with Escape and hands focus back to its button', async () => {
    renderWithProviders(<Harness media={mediaItem()} />)
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Options for Busboys (2026)' }),
    )
  })
})
