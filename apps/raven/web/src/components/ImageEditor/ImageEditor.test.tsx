import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemImageOptions } from '@raven/core'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { api } from '@/lib/api'
import { itemDetails, library, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const OPTIONS: ItemImageOptions = {
  poster: [
    {
      source: 'local',
      ref: '/media/poster.jpg',
      width: null,
      height: null,
      language: null,
      current: true,
    },
    { source: 'tmdb', ref: '/p2.jpg', width: 2000, height: 3000, language: 'en', current: false },
  ],
  backdrop: [
    { source: 'tmdb', ref: '/b1.jpg', width: 3840, height: 2160, language: null, current: true },
  ],
}

describe('ImageEditor', () => {
  const spies = {
    options: spyOn(api, 'getItemImages'),
    choose: spyOn(api, 'chooseItemImage'),
  }
  const state = { done: 0 }

  const open = (overrides: Parameters<typeof itemDetails>[0] = {}) => {
    spies.options.mockImplementation(async () => OPTIONS)
    spies.choose.mockImplementation(async () => itemDetails({ posterVersion: 'new' }))
    renderWithProviders(
      <ImageEditor
        details={itemDetails(overrides)}
        libraries={[library({ id: 2, name: 'Films' })]}
        onDone={() => {
          state.done += 1
        }}
      />,
    )
  }

  afterEach(() => {
    spies.options.mockReset()
    spies.choose.mockReset()
    state.done = 0
  })

  it('offers every poster and backdrop, marking the current ones', async () => {
    open()
    const local = await screen.findByRole('button', { name: 'Poster: Beside the files' })
    expect(local).toHaveAttribute('aria-pressed', 'true')
    expect(local).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Poster: TMDB, 2000 by 3000, English' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: 'Backdrop: TMDB, 3840 by 2160, No text' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('chooses a picture of TMDB’s, and goes back to the one beside the files', async () => {
    open()
    // Once a choice is saved, the options are asked for again and say so.
    const chosen = { current: false }
    spies.options.mockImplementation(async () =>
      chosen.current
        ? {
            ...OPTIONS,
            poster: OPTIONS.poster.map((option) => ({
              ...option,
              current: option.source === 'tmdb',
            })),
          }
        : OPTIONS,
    )
    spies.choose.mockImplementation(async () => {
      chosen.current = true
      return itemDetails({ posterVersion: 'new' })
    })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Poster: TMDB, 2000 by 3000, English' }),
    )
    await waitFor(() => expect(spies.choose).toHaveBeenCalledTimes(1))
    expect(spies.choose.mock.calls[0]?.[0]).toEqual({
      id: 40,
      kind: 'poster',
      choice: { source: 'tmdb', ref: '/p2.jpg' },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Poster: Beside the files' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Poster: Beside the files' }))
    await waitFor(() => expect(spies.choose).toHaveBeenCalledTimes(2))
    expect(spies.choose.mock.calls[1]?.[0]).toEqual({
      id: 40,
      kind: 'poster',
      choice: { source: 'local' },
    })
  })

  it('lists the linked files that share the pictures, and closes with Done', async () => {
    open({
      versions: [
        matchedMovie({ id: 1, fileName: 'Avatar (2009) Remux-2160p.mkv', edition: null }),
        matchedMovie({
          id: 2,
          fileName: 'Avatar (2009) {edition-Extended} Remux-2160p.mkv',
          edition: 'Extended',
        }),
      ],
    })
    expect(await screen.findByRole('heading', { name: 'Linked files' })).toBeInTheDocument()
    expect(screen.getByText('Avatar (2009) {edition-Extended} Remux-2160p.mkv')).toBeInTheDocument()
    expect(screen.getByText('Extended')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(state.done).toBe(1)
  })
})
