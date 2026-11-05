import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { PLAYED_KINDS, PLAY_HISTORY_SHOWS, type PlayHistoryEntry, type Played } from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { EveryonesHistoryPage, PlayHistoryPage } from '@/pages/PlayHistoryPage/PlayHistoryPage'
import { fakeAccount } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

const FRIEND = '30000000-0000-4000-8000-000000000002'

type EntryProps = {
  id: number
  played: Played
  accountId?: string
  furthest?: number | null
  duration?: number | null
}

const entry = ({
  id,
  played,
  accountId = FRIEND,
  furthest = 1,
  duration = 200,
}: EntryProps): PlayHistoryEntry => ({
  id,
  accountId,
  mediaId: id,
  startedAt: '2026-11-04T12:00:00.000Z',
  lastPlayedAt: '2026-11-04T12:00:01.000Z',
  furthest,
  duration,
  libraryId: 1,
  libraryName: 'Music',
  played,
})

const track = (number: number): Played => ({
  kind: PLAYED_KINDS.track,
  title: `Song ${number}`,
  artist: 'Radiohead',
  album: 'OK Computer',
  albumId: 7,
  disc: 1,
  number,
  albumTracks: 2,
})

const episode: Played = {
  kind: PLAYED_KINDS.episode,
  show: 'Severance',
  season: 1,
  episode: 2,
  title: 'Half Loop',
}

describe('PlayHistoryPage', () => {
  const spies = {
    own: spyOn(api, 'listPlayHistory'),
    everyone: spyOn(api, 'listEveryonesHistory'),
    members: spyOn(api, 'listMembers'),
  }

  afterEach(() => {
    cleanup()
    spies.own.mockReset()
    spies.everyone.mockReset()
    spies.members.mockReset()
  })

  it('lists what played as a table: when, what, from where, and how far, with no pictures', async () => {
    spies.own.mockImplementation(async () => ({
      entries: [
        entry({ id: 4, played: track(2), furthest: 199 }),
        entry({ id: 3, played: track(1), furthest: 1 }),
        entry({ id: 2, played: episode, furthest: 600, duration: 3000 }),
        entry({ id: 1, played: track(1), furthest: null }),
      ],
      next: null,
    }))
    renderWithProviders({ ui: <PlayHistoryPage /> })

    const table = await screen.findByRole('table', { name: 'What was played' })
    expect(within(table).queryAllByRole('img')).toEqual([])
    expect(within(table).getByText('OK Computer by Radiohead: the whole album')).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Half Loop' })).toBeInTheDocument()
    expect(within(table).getByText('Severance · S01E02')).toBeInTheDocument()
    expect(within(table).getByText('10:00 of 50:00 (20%)')).toBeInTheDocument()
    expect(within(table).getByText('0:01 of 3:20 (0%)')).toBeInTheDocument()
    expect(within(table).getByText('Finished')).toBeInTheDocument()
    expect(within(table).getByText('Listened')).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Account' })).toBeNull()
    expect(spies.everyone).not.toHaveBeenCalled()
  })

  it('shows one kind when asked, and more when there is more', async () => {
    spies.own.mockImplementation(async ({ before }) =>
      before === null
        ? { entries: [entry({ id: 2, played: track(1) })], next: 2 }
        : { entries: [entry({ id: 1, played: episode })], next: null },
    )
    renderWithProviders({ ui: <PlayHistoryPage /> })
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('rowheader', { name: 'Half Loop' })).toBeInTheDocument()
    expect(spies.own).toHaveBeenCalledWith({ before: 2, show: PLAY_HISTORY_SHOWS.all })

    await userEvent.click(screen.getByRole('button', { name: 'Music' }))
    await waitFor(() =>
      expect(spies.own).toHaveBeenCalledWith({ before: null, show: PLAY_HISTORY_SHOWS.music }),
    )
  })

  it("links the owner to everyone's history, and no one else", async () => {
    spies.own.mockImplementation(async () => ({ entries: [], next: null }))
    renderWithProviders({ ui: <PlayHistoryPage />, account: fakeAccount(), adminLock: null })
    await screen.findByText('Nothing has played yet.')
    expect(screen.queryByRole('link', { name: 'See everyone’s history' })).toBeNull()
    cleanup()
    renderWithProviders({
      ui: <PlayHistoryPage />,
      account: fakeAccount({ isOwner: true }),
      adminLock: null,
    })
    expect(await screen.findByRole('link', { name: 'See everyone’s history' })).toHaveAttribute(
      'href',
      '/history/everyone',
    )
  })

  it('says so when nothing has played', async () => {
    spies.own.mockImplementation(async () => ({ entries: [], next: null }))
    renderWithProviders({ ui: <PlayHistoryPage /> })
    expect(await screen.findByText('Nothing has played yet.')).toBeInTheDocument()
  })
})

describe('EveryonesHistoryPage', () => {
  const spies = {
    everyone: spyOn(api, 'listEveryonesHistory'),
    members: spyOn(api, 'listMembers'),
  }

  afterEach(() => {
    cleanup()
    spies.everyone.mockReset()
    spies.members.mockReset()
  })

  it("names each entry's account for the owner, and reads one account's when picked", async () => {
    const owner = fakeAccount({ isOwner: true })
    spies.members.mockImplementation(async () => [
      owner,
      fakeAccount({ id: FRIEND, email: 'friend@maester.test' }),
    ])
    spies.everyone.mockImplementation(async () => ({
      entries: [entry({ id: 1, played: episode })],
      next: null,
    }))
    renderWithProviders({ ui: <EveryonesHistoryPage />, account: owner, adminLock: null })

    const table = await screen.findByRole('table')
    expect(await within(table).findByText('friend@maester.test')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), FRIEND)
    await waitFor(() =>
      expect(spies.everyone).toHaveBeenCalledWith({
        accountId: FRIEND,
        before: null,
        show: PLAY_HISTORY_SHOWS.all,
      }),
    )
  })

  it('asks nothing of the server for a member, and says the page is the owner’s', async () => {
    renderWithProviders({ ui: <EveryonesHistoryPage />, account: fakeAccount(), adminLock: null })
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/owner/i)
    expect(spies.everyone).not.toHaveBeenCalled()
  })
})
