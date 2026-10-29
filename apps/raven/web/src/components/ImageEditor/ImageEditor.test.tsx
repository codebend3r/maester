import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IMAGE_SOURCES, ITEM_TYPES, type ItemImageOptions, type MatchItemType } from '@raven/core'
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
  logo: [
    { source: 'tmdb', ref: '/l1.png', width: 1000, height: 400, language: 'en', current: true },
    { source: 'tmdb', ref: '/l2.png', width: 1200, height: 300, language: 'en', current: false },
  ],
}

describe('ImageEditor', () => {
  const spies = {
    options: spyOn(api, 'getItemImages'),
    choose: spyOn(api, 'chooseItemImage'),
  }
  const state = { done: 0 }

  type OpenProps = {
    overrides?: Parameters<typeof itemDetails>[0]
    itemKind?: MatchItemType
  }

  const open = ({ overrides = {}, itemKind = ITEM_TYPES.movie }: OpenProps = {}) => {
    spies.options.mockImplementation(async () => OPTIONS)
    spies.choose.mockImplementation(async () => itemDetails({ posterVersion: 'new' }))
    renderWithProviders({
      ui: (
        <ImageEditor
          details={itemDetails(overrides)}
          libraries={[library({ id: 2, name: 'Films' }), library({ id: 3, name: '4K Films' })]}
          libraryId={2}
          itemKind={itemKind}
          onDone={() => {
            state.done += 1
          }}
        />
      ),
    })
  }

  afterEach(() => {
    cleanup()
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
    expect(screen.queryByRole('button', { name: /^Backdrop:/ })).toBeNull()
    const tabs = screen.getByRole('tablist', { name: 'Pictures' })
    expect(within(tabs).getByRole('tab', { name: 'Poster 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Backdrop 1' }))
    expect(
      screen.getByRole('button', { name: 'Backdrop: TMDB, 3840 by 2160, No text' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^Poster:/ })).toBeNull()
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
              current: option.source === IMAGE_SOURCES.tmdb,
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
      libraryId: 2,
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
      libraryId: 2,
      choice: { source: 'local' },
    })
  })

  it("offers a movie's logos on a tab of their own, and chooses one", async () => {
    open()
    const tabs = await screen.findByRole('tablist', { name: 'Pictures' })
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Logo 2' }))
    expect(
      screen.getByRole('button', { name: 'Logo: TMDB, 1000 by 400, English' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Logo: TMDB, 1200 by 300, English' }))
    await waitFor(() => expect(spies.choose).toHaveBeenCalledTimes(1))
    expect(spies.choose.mock.calls[0]?.[0]).toEqual({
      id: 40,
      kind: 'logo',
      libraryId: 2,
      choice: { source: 'tmdb', ref: '/l2.png' },
    })
  })

  it('steps between the tabs with the arrow keys, both ways', async () => {
    open()
    const tabs = await screen.findByRole('tablist', { name: 'Pictures' })
    within(tabs).getByRole('tab', { name: 'Poster 2' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(tabs).getByRole('tab', { name: 'Logo 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.keyboard('{ArrowRight}')
    expect(within(tabs).getByRole('tab', { name: 'Poster 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('has a logo tab for a show, as for a movie', async () => {
    open({ itemKind: ITEM_TYPES.show })
    const tabs = await screen.findByRole('tablist', { name: 'Pictures' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Poster2', 'Backdrop1', 'Logo2'])
  })

  it("asks which library's pictures to choose for a title several hold, and keeps to that one", async () => {
    open({
      overrides: {
        versions: [
          matchedMovie({ id: 1, libraryId: 2, fileName: 'Avatar (2009) Bluray-1080p.mkv' }),
          matchedMovie({ id: 2, libraryId: 3, fileName: 'Avatar (2009) Remux-2160p.mkv' }),
        ],
        libraryPictures: [
          { libraryId: 2, posterVersion: 'hd', backdropVersion: null, logoVersion: null },
          { libraryId: 3, posterVersion: 'uhd', backdropVersion: null, logoVersion: null },
        ],
      },
    })
    const menu = await screen.findByRole('combobox', { name: 'Pictures for' })
    expect(menu).toHaveValue('2')
    expect(spies.options.mock.calls[0]?.[0] ?? null).toEqual({ id: 40, libraryId: 2 })
    expect(screen.getByText('Avatar (2009) Bluray-1080p.mkv')).toBeInTheDocument()
    expect(screen.queryByText('Avatar (2009) Remux-2160p.mkv')).toBeNull()

    await userEvent.selectOptions(menu, '3')
    await waitFor(() =>
      expect(spies.options.mock.calls.map(([asked]) => asked)).toContainEqual({
        id: 40,
        libraryId: 3,
      }),
    )
    expect(await screen.findByText('Avatar (2009) Remux-2160p.mkv')).toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Poster: TMDB, 2000 by 3000, English' }),
    )
    await waitFor(() => expect(spies.choose).toHaveBeenCalledTimes(1))
    expect(spies.choose.mock.calls[0]?.[0] ?? null).toMatchObject({ id: 40, libraryId: 3 })
  })

  it('lists the linked files that share the pictures, and closes with Done', async () => {
    open({
      overrides: {
        versions: [
          matchedMovie({ id: 1, fileName: 'Avatar (2009) Remux-2160p.mkv', edition: null }),
          matchedMovie({
            id: 2,
            fileName: 'Avatar (2009) {edition-Extended} Remux-2160p.mkv',
            edition: 'Extended',
          }),
        ],
      },
    })
    expect(await screen.findByRole('heading', { name: 'Linked files' })).toBeInTheDocument()
    expect(screen.getByText('Avatar (2009) {edition-Extended} Remux-2160p.mkv')).toBeInTheDocument()
    expect(screen.getByText('Extended')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(state.done).toBe(1)
  })
})
