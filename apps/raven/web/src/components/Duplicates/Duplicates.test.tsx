import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { ApiError, type Duplicates as DuplicatesListing } from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { POSTER_SIZES } from '@/lib/posters'
import { SectionView } from '@/pages/LibraryPage/SectionViews'
import { itemSummary, library, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const alexander = itemSummary({ id: 40, title: 'Alexander', year: 2004 })
const theatrical = matchedMovie({
  id: 4,
  fileName: 'Alexander (2004) Remux-2160p.mkv',
  width: 3840,
  height: 2160,
  item: alexander,
  versions: 2,
})
const webdl = matchedMovie({
  id: 6,
  fileName: 'Alexander (2004) WEBDL-1080p.mkv',
  item: alexander,
  versions: 2,
})
const finalCut = matchedMovie({
  id: 5,
  fileName: 'Alexander 2004 Revisited the Final Cut (2004).mkv',
  item: alexander,
})

const FINAL_CUT = { label: 'Revisited the Final Cut', key: 'revisited final' }

const heat = itemSummary({ id: 50, title: 'Heat', year: 1995 })
const heatCopies = [
  matchedMovie({ id: 7, fileName: 'Heat (1995) 2160p HEVC.mkv', item: heat, versions: 2 }),
  matchedMovie({ id: 8, fileName: 'Heat (1995) WEBDL-2160p.mkv', item: heat, versions: 2 }),
]

const heatMovie: DuplicatesListing[number] = {
  itemId: 50,
  cards: [
    {
      entry: { media: heatCopies[0] ?? theatrical, poster: heat },
      files: heatCopies.map((media) => ({ media, cut: null })),
    },
  ],
}

const LISTING: DuplicatesListing = [
  {
    itemId: 40,
    cards: [
      {
        entry: { media: { ...theatrical, versions: 3 }, poster: alexander },
        files: [
          { media: theatrical, cut: null },
          { media: finalCut, cut: FINAL_CUT },
          { media: webdl, cut: null },
        ],
      },
    ],
  },
  heatMovie,
]

/** Alexander once its WEBDL copy is deleted. */
const WITHOUT_WEBDL: DuplicatesListing[number] = {
  itemId: 40,
  cards: [
    {
      entry: { media: { ...theatrical, versions: 2 }, poster: alexander },
      files: [
        { media: theatrical, cut: null },
        { media: finalCut, cut: FINAL_CUT },
      ],
    },
  ],
}

/** Alexander after Smart split apart: its own card keeps the two plain copies, the Final Cut has one. */
const AFTER_SPLIT: DuplicatesListing = [
  {
    itemId: 40,
    cards: [
      {
        entry: { media: theatrical, poster: alexander },
        files: [
          { media: theatrical, cut: null },
          { media: webdl, cut: null },
        ],
      },
      {
        entry: {
          media: { ...finalCut, variant: 'Revisited the Final Cut' },
          poster: alexander,
        },
        files: [{ media: finalCut, cut: FINAL_CUT }],
      },
    ],
  },
  heatMovie,
]

describe('the Duplicates tab', () => {
  const spies = {
    list: spyOn(api, 'listDuplicates'),
    split: spyOn(api, 'splitDuplicate'),
    join: spyOn(api, 'joinSplit'),
    remove: spyOn(api, 'deleteMedia'),
  }

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  /** The tab as the library page opens it, its listing read through the query. */
  const show = async (listing: DuplicatesListing = LISTING) => {
    spies.list.mockImplementation(async () => listing)
    renderWithProviders({
      ui: <SectionView library={library({ id: 2, name: 'Films' })} section="duplicates" />,
    })
    await waitFor(() => expect(spies.list).toHaveBeenCalledWith(2))
    await waitFor(() => expect(screen.queryByText('Loading')).toBeNull())
  }

  const movie = (title: string): HTMLElement => screen.getByRole('article', { name: title })

  /** A split or join the server answers with `listing`, which the tab then reads again as well. */
  const answers = (listing: DuplicatesListing) => async () => {
    spies.list.mockImplementation(async () => listing)
    return listing
  }

  it('lists each movie with more than one file, each file with the cut its name reads as', async () => {
    await show()
    const files = within(movie('Alexander')).getByRole('list', { name: 'Files' })
    expect(
      within(files)
        .getAllByRole('listitem')
        .map((file) => file.textContent),
    ).toEqual([
      expect.stringContaining('Standard'),
      expect.stringContaining('Revisited the Final Cut'),
      expect.stringContaining('Standard'),
    ])
    expect(within(movie('Alexander')).getByText('2004 · 3 files')).toBeInTheDocument()
    expect(within(movie('Alexander')).getByRole('link', { name: 'Alexander' })).toHaveAttribute(
      'href',
      '/movies/40?library=2',
    )
    expect(
      within(movie('Alexander')).queryByRole('button', { name: 'Put back together' }),
    ).toBeNull()
    const poster = movie('Alexander').querySelector('img')
    expect(poster?.getAttribute('srcset')).toContain('?w=185 185w')
    expect(poster).toHaveAttribute('sizes', POSTER_SIZES.duplicate)
  })

  it('offers Smart split apart only where the files read as different cuts', async () => {
    await show()
    expect(
      within(movie('Alexander')).getByRole('button', { name: 'Smart split apart' }),
    ).toBeEnabled()
    expect(within(movie('Heat')).getByRole('button', { name: 'Smart split apart' })).toBeDisabled()
    expect(
      within(movie('Heat')).getByText(
        'Every file reads as the same cut, so Smart split apart has nothing to tell apart.',
      ),
    ).toBeInTheDocument()
    expect(within(movie('Heat')).getByRole('button', { name: 'Split apart' })).toBeEnabled()
  })

  it('finds nothing to tell apart in one cut named two ways', async () => {
    const watchmen = itemSummary({ id: 60, title: 'Watchmen', year: 2009 })
    const first = matchedMovie({
      id: 9,
      fileName: "Watchmen Director's Cut (2009).mkv",
      item: watchmen,
    })
    const second = matchedMovie({
      id: 10,
      fileName: 'Watchmen (Directors Edition) (2009).mkv',
      item: watchmen,
    })
    await show([
      {
        itemId: 60,
        cards: [
          {
            entry: { media: { ...first, versions: 2 }, poster: watchmen },
            files: [
              { media: first, cut: { label: "Director's Cut", key: 'directors' } },
              { media: second, cut: { label: 'Directors Edition', key: 'directors' } },
            ],
          },
        ],
      },
    ])
    const files = within(movie('Watchmen')).getByRole('list', { name: 'Files' })
    expect(
      within(files)
        .getAllByRole('listitem')
        .map((file) => file.textContent),
    ).toEqual([
      expect.stringContaining("Director's Cut"),
      expect.stringContaining('Directors Edition'),
    ])
    expect(
      within(movie('Watchmen')).getByRole('button', { name: 'Smart split apart' }),
    ).toBeDisabled()
  })

  it('keeps a split movie in the list as its separate cards, ready to put back together', async () => {
    spies.split.mockImplementation(answers(AFTER_SPLIT))
    spies.join.mockImplementation(answers(LISTING))
    await show()
    await userEvent.click(
      within(movie('Alexander')).getByRole('button', { name: 'Smart split apart' }),
    )
    expect(spies.split).toHaveBeenCalledWith({ libraryId: 2, mediaId: 4, how: 'smart' })

    const cards = await within(movie('Alexander')).findByRole('list', { name: 'Cards' })
    expect(
      within(cards)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['Alexander', 'Alexander (Revisited the Final Cut)'])
    expect(
      within(cards).getByRole('link', { name: 'Alexander (Revisited the Final Cut)' }),
    ).toHaveAttribute('href', '/movies/40?library=2&file=5')
    expect(within(movie('Alexander')).getByText('2004 · 3 files · 2 cards')).toBeInTheDocument()
    // The movie's own card still holds two copies, so it can be split again; the Final Cut cannot.
    expect(within(cards).getAllByRole('button', { name: 'Split apart' })).toHaveLength(1)

    await userEvent.click(
      within(movie('Alexander')).getByRole('button', { name: 'Put back together' }),
    )
    expect(spies.join).toHaveBeenCalledWith({ libraryId: 2, itemId: 40 })
    expect(await within(movie('Alexander')).findByText('2004 · 3 files')).toBeInTheDocument()
  })

  it('splits every file apart', async () => {
    spies.split.mockImplementation(answers(AFTER_SPLIT))
    await show()
    await userEvent.click(within(movie('Heat')).getByRole('button', { name: 'Split apart' }))
    await waitFor(() =>
      expect(spies.split).toHaveBeenCalledWith({ libraryId: 2, mediaId: 7, how: 'apart' }),
    )
  })

  it('says why a split did not happen', async () => {
    spies.split.mockImplementation(async () => {
      throw new ApiError({
        status: 409,
        message: 'That card holds one file, so there is nothing to split.',
      })
    })
    await show()
    await userEvent.click(within(movie('Heat')).getByRole('button', { name: 'Split apart' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That card holds one file, so there is nothing to split.',
    )
  })

  it('asks before deleting a file, then deletes it from the server and drops it from the list', async () => {
    spies.remove.mockImplementation(async () => {
      spies.list.mockImplementation(async () => [WITHOUT_WEBDL, heatMovie])
    })
    await show()
    await userEvent.click(
      within(movie('Alexander')).getByRole('button', {
        name: 'Delete Alexander (2004) WEBDL-1080p.mkv',
      }),
    )
    expect(spies.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Alexander (2004)?')
    expect(screen.getByRole('dialog')).toHaveTextContent('Alexander (2004) WEBDL-1080p.mkv')
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith(6))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(movie('Alexander')).findByText('2004 · 2 files')).toBeInTheDocument()
  })

  it('keeps the file when the confirmation is cancelled', async () => {
    await show()
    await userEvent.click(
      within(movie('Heat')).getByRole('button', { name: 'Delete Heat (1995) 2160p HEVC.mkv' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(spies.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says why a file was not deleted', async () => {
    spies.remove.mockImplementation(async () => {
      throw new ApiError({ status: 500, message: 'Could not delete the file.' })
    })
    await show()
    await userEvent.click(
      within(movie('Heat')).getByRole('button', { name: 'Delete Heat (1995) 2160p HEVC.mkv' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Could not delete the file.',
    )
  })

  it('leaves splitting, putting back together and deleting out while the admin lock is on', async () => {
    spies.list.mockImplementation(async () => AFTER_SPLIT)
    renderWithProviders({
      ui: <SectionView library={library({ id: 2, name: 'Films' })} section="duplicates" />,
      adminLock: { state: 'on', available: true },
    })
    expect(await screen.findByRole('article', { name: 'Alexander' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Heat' })).toBeInTheDocument()
    expect(
      screen.queryAllByRole('button', { name: /split apart|put back together|delete/i }),
    ).toEqual([])
  })

  it('says when no movie holds more than one file', async () => {
    await show([])
    expect(screen.getByText('No movie in Films has more than one file.')).toBeInTheDocument()
  })
})
