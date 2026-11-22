import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  ARTIST_BACKGROUND_KINDS,
  type Account,
  type ArtistBackgrounds,
  MEMBER_STATUSES,
} from '@raven/core'
import { ARTIST_COPY } from '@raven/wren'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { artistPath } from '@/routes'
import { SIGNED_IN, fakeAuthClient } from '@/test/authClient'
import { RADIOHEAD, RADIOHEAD_PAGE, mockMusicAndWritesEach } from '@/test/music'
import { renderWithProviders, signedIn } from '@/test/render'
import { FORM_FACTORS } from '@/theme/formFactor'

const mocked = mockMusicAndWritesEach()

const BACKGROUNDS: ArtistBackgrounds = {
  options: [
    { key: 'aaaa', kind: ARTIST_BACKGROUND_KINDS.photo },
    { key: 'bbbb', kind: ARTIST_BACKGROUND_KINDS.cover },
  ],
  chosen: 'aaaa',
}

type Spies = {
  getMe: ReturnType<typeof spyOn<typeof api, 'getMe'>>
  list: ReturnType<typeof spyOn<typeof api, 'listArtistBackgrounds'>>
  set: ReturnType<typeof spyOn<typeof api, 'setArtistBackground'>>
}

const held: { spies: Spies | null } = { spies: null }

const spiesOf = (): Spies => {
  if (held.spies === null) throw new Error('the api is spied before each test')
  return held.spies
}

const accountOf = (isOwner: boolean): Account => ({
  id: SIGNED_IN.userId,
  email: 'owner@example.com',
  status: MEMBER_STATUSES.approved,
  isOwner,
})

beforeEach(() => {
  held.spies = {
    getMe: spyOn(api, 'getMe').mockResolvedValue(accountOf(true)),
    list: spyOn(api, 'listArtistBackgrounds').mockResolvedValue(BACKGROUNDS),
    set: spyOn(api, 'setArtistBackground').mockResolvedValue(RADIOHEAD_PAGE),
  }
})

afterEach(() => {
  Object.values(held.spies ?? {}).forEach((spy) => spy.mockRestore())
  held.spies = null
})

type RenderArtistProps = { isOwner: boolean }

const renderArtist = async ({ isOwner }: RenderArtistProps) => {
  spiesOf().getMe.mockResolvedValue(accountOf(isOwner))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  signedIn({ client, auth: fakeAuthClient().client })
  renderWithProviders({
    ui: <AppRoutes />,
    route: artistPath(RADIOHEAD.id),
    formFactor: FORM_FACTORS.tablet,
    authConfig: null,
    client,
  })
  await screen.findByRole('heading', { level: 1, name: RADIOHEAD.name })
}

describe('Artist background', () => {
  it('shows the owner Edit background image after Follow', async () => {
    mocked()
    await renderArtist({ isOwner: true })
    const edit = await screen.findByRole('button', { name: ARTIST_COPY.editBackground })
    const follow = screen.getByRole('switch', { name: 'Follow' })
    expect(follow.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows anyone else nothing', async () => {
    await renderArtist({ isOwner: false })
    await waitFor(() => expect(spiesOf().getMe).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: ARTIST_COPY.editBackground })).toBeNull()
  })

  it('lays the options out in a grid, marking the one in use', async () => {
    await renderArtist({ isOwner: true })
    await userEvent.click(await screen.findByRole('button', { name: ARTIST_COPY.editBackground }))
    const grid = await screen.findByRole('list', { name: ARTIST_COPY.backgroundTitle })
    const choices = within(grid).getAllByRole('button')
    expect(choices).toHaveLength(BACKGROUNDS.options.length + 1)
    expect(
      within(grid).getByRole('button', {
        name: ARTIST_COPY.backgroundOption({ kind: ARTIST_BACKGROUND_KINDS.photo, position: 1 }),
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(grid).getByRole('button', { name: ARTIST_COPY.backgroundDefault }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('sets the option pressed and closes', async () => {
    await renderArtist({ isOwner: true })
    await userEvent.click(await screen.findByRole('button', { name: ARTIST_COPY.editBackground }))
    await userEvent.click(
      await screen.findByRole('button', {
        name: ARTIST_COPY.backgroundOption({ kind: ARTIST_BACKGROUND_KINDS.cover, position: 2 }),
      }),
    )
    await waitFor(() =>
      expect(spiesOf().set).toHaveBeenCalledWith({ artistId: RADIOHEAD.id, key: 'bbbb' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: ARTIST_COPY.backgroundTitle })).toBeNull(),
    )
  })

  it('goes back to the default photo with null', async () => {
    await renderArtist({ isOwner: true })
    await userEvent.click(await screen.findByRole('button', { name: ARTIST_COPY.editBackground }))
    await userEvent.click(
      await screen.findByRole('button', { name: ARTIST_COPY.backgroundDefault }),
    )
    await waitFor(() =>
      expect(spiesOf().set).toHaveBeenCalledWith({ artistId: RADIOHEAD.id, key: null }),
    )
  })

  it("says when the pictures can't be loaded", async () => {
    spiesOf().list.mockRejectedValue(new Error('down'))
    await renderArtist({ isOwner: true })
    await userEvent.click(await screen.findByRole('button', { name: ARTIST_COPY.editBackground }))
    expect(await screen.findByText(ARTIST_COPY.backgroundFailed)).toBeInTheDocument()
  })
})
