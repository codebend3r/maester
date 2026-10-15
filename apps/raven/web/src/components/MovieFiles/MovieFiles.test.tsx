import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MediaItem } from '@raven/core'
import { MovieFiles } from '@/components/MovieFiles/MovieFiles'
import { api } from '@/lib/api'
import { held } from '@/test/held'
import { itemSummary, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const STRAYS = itemSummary({ id: 40, title: 'Strays', year: 2023 })
const REMUX = matchedMovie({
  id: 1,
  libraryId: 2,
  item: STRAYS,
  fileName: 'Strays (2023) 1080p Remux.mkv',
})
const WEBDL = matchedMovie({
  id: 2,
  libraryId: 2,
  item: STRAYS,
  fileName: 'Strays, The (2023) 1080p WEBDL.mkv',
})

const files = () => screen.getByRole('region', { name: /^(File|\d+ files)$/ })

const show = ({
  card,
  everyCard = card,
}: {
  card: readonly [MediaItem, ...MediaItem[]]
  everyCard?: readonly MediaItem[]
}) => renderWithProviders(<MovieFiles files={card} everyCard={everyCard} itemId={STRAYS.id} />)

describe('MovieFiles', () => {
  const spies = { split: spyOn(api, 'splitDuplicate'), join: spyOn(api, 'joinSplit') }

  afterEach(() => {
    spies.split.mockReset()
    spies.join.mockReset()
  })

  it('names the one file, without a count or a way to split it', () => {
    show({ card: [REMUX] })
    expect(screen.getByRole('heading', { name: 'File' })).toBeInTheDocument()
    expect(within(files()).getByText('Strays (2023) 1080p Remux.mkv')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Split apart' })).toBeNull()
  })

  it('counts the files once there are two, with one Split apart for them all', () => {
    show({ card: [REMUX, WEBDL] })
    expect(screen.getByRole('heading', { name: '2 files' })).toBeInTheDocument()
    expect(
      within(files())
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['Strays (2023) 1080p Remux.mkv', 'Strays, The (2023) 1080p WEBDL.mkv'])
    expect(screen.getAllByRole('button', { name: 'Split apart' })).toHaveLength(1)
  })

  it('gives every file a card of its own in the library, and says so', async () => {
    const answer = held<Awaited<ReturnType<typeof api.splitDuplicate>>>()
    spies.split.mockImplementation(() => answer.promise)
    show({ card: [REMUX, WEBDL] })
    await userEvent.click(screen.getByRole('button', { name: 'Split apart' }))
    expect(spies.split.mock.calls).toEqual([[{ libraryId: 2, mediaId: 1, how: 'apart' }]])
    expect(screen.getByRole('button', { name: 'Split apart' })).toBeDisabled()
    answer.answer([])
    expect(await screen.findByText('Each file has a card of its own now.')).toBeInTheDocument()
  })

  it("links the movie's other cards once it is split, and puts them back together", async () => {
    spies.join.mockImplementation(async () => [])
    const own = { ...REMUX, card: 'file:1', variant: 'Remux-1080p' }
    const other = { ...WEBDL, card: 'file:2', variant: 'WEBDL-1080p' }
    show({ card: [own], everyCard: [own, other] })
    const others = screen.getByRole('region', { name: 'On cards of their own' })
    expect(
      within(others).getByRole('link', { name: 'Strays, The (2023) 1080p WEBDL.mkv' }),
    ).toHaveAttribute('href', '/movies/40?library=2&file=2')
    await userEvent.click(within(others).getByRole('button', { name: 'Put back together' }))
    expect(spies.join.mock.calls).toEqual([[{ libraryId: 2, itemId: 40 }]])
    expect(await screen.findByText('Every file is back on one card.')).toBeInTheDocument()
  })

  it('says why a split failed', async () => {
    spies.split.mockImplementation(async () => {
      throw new Error('That card holds one file, so there is nothing to split.')
    })
    show({ card: [REMUX, WEBDL] })
    await userEvent.click(screen.getByRole('button', { name: 'Split apart' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing to split')
  })
})
