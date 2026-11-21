import { describe, expect, it } from 'bun:test'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import { ARTIST_COPY, DETAIL_COPY, KIT_COPY, PLAYER_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/AppRoutes'
import { albumPath, artistPath } from '@/routes'
import {
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  OK_COMPUTER_TILE,
  RADIOHEAD,
  RADIOHEAD_PAGE,
  mockMusicAndWritesEach,
  mockQueueEach,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const ARTIST_URL = artistPath(RADIOHEAD.id)

const SOURCE = { kind: QUEUE_SOURCE_KINDS.artist, id: RADIOHEAD.id }

const mocked = mockMusicAndWritesEach()

type RenderArtistProps = { formFactor?: FormFactor }

/** The app on the artist's page, once the artist is read. */
const renderArtist = async ({ formFactor = FORM_FACTORS.phone }: RenderArtistProps = {}) => {
  renderWithProviders({ ui: <AppRoutes />, route: ARTIST_URL, formFactor })
  return screen.findByRole('heading', { level: 1, name: RADIOHEAD.name })
}

/** The hero the artist's name sits in. */
const heroOf = (name: HTMLElement): HTMLElement => {
  const hero = name.closest('header')
  if (hero === null) throw new Error('the name sits in no hero')
  return hero
}

describe('Artist', () => {
  const { playTracks, addToQueue } = mockQueueEach()

  it('names the artist with their counts, follows them, and opens one of their albums', async () => {
    await renderArtist()
    expect(screen.getByText('1 album · 3 songs')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ARTIST_COPY.albums })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: ARTIST_COPY.appearsOn })).toBeNull()

    await userEvent.click(screen.getByRole('switch', { name: PLAYER_COPY.follow }))
    expect(mocked().writes.setArtistFavourite).toHaveBeenCalledWith({
      artistId: RADIOHEAD.id,
      favourite: true,
    })

    const tile = screen.getByRole('link', { name: OK_COMPUTER_TILE })
    expect(tile).toHaveAttribute('href', albumPath(OK_COMPUTER.id))
    expect(tile).toHaveTextContent(String(OK_COMPUTER.year))
    await userEvent.click(tile)
    expect(
      await screen.findByRole('heading', { level: 1, name: OK_COMPUTER.title }),
    ).toBeInTheDocument()
  })

  it('lists the albums of others they appear on, under their artists', async () => {
    const guest = { ...OK_COMPUTER, id: OK_COMPUTER.id + 1, title: 'Help' }
    mocked().music.getArtist.mockResolvedValue({
      ...RADIOHEAD_PAGE,
      albums: [],
      appearsOn: [guest],
    })
    await renderArtist()

    expect(screen.queryByRole('heading', { name: ARTIST_COPY.albums })).toBeNull()
    expect(screen.getByRole('heading', { name: ARTIST_COPY.appearsOn })).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: guest.title, value: RADIOHEAD.name }),
      }),
    ).toHaveTextContent(RADIOHEAD.name)
  })

  it("plays and shuffles the artist's albums, read as they are asked for", async () => {
    await renderArtist()
    expect(mocked().music.getAlbum).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.play }))
    await waitFor(() =>
      expect(playTracks).toHaveBeenCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source: SOURCE,
        isShuffled: false,
      }),
    )
    expect(mocked().music.getAlbum).toHaveBeenCalledWith(OK_COMPUTER.id)

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    await waitFor(() =>
      expect(playTracks).toHaveBeenLastCalledWith({
        tracks: OK_COMPUTER_PAGE.tracks,
        source: SOURCE,
        isShuffled: true,
      }),
    )
  })

  it('says why their songs could not be read, and plays nothing', async () => {
    mocked().music.getAlbum.mockRejectedValue(new Error('raven is out of reach.'))
    await renderArtist()
    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.play }))

    expect(await screen.findByText('raven is out of reach.')).toBeInTheDocument()
    expect(playTracks).not.toHaveBeenCalled()
  })

  it("adds the artist's songs to the queue from More, which offers no playlist", async () => {
    await renderArtist()
    await userEvent.click(screen.getByRole('button', { name: DETAIL_COPY.more }))
    const sheet = screen.getByRole('dialog', { name: RADIOHEAD.name })
    expect(within(sheet).queryByRole('button', { name: TRACK_MENU_COPY.addToPlaylist })).toBeNull()

    await userEvent.click(within(sheet).getByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks))
  })

  it('sets Play, Shuffle and Follow under the hero under 48rem', async () => {
    const hero = within(heroOf(await renderArtist({ formFactor: FORM_FACTORS.phone })))

    expect(hero.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
    expect(hero.getByRole('button', { name: DETAIL_COPY.more })).toBeInTheDocument()
    expect(hero.queryByRole('button', { name: PLAYER_COPY.play })).toBeNull()
    expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeInTheDocument()
  })

  it("sets them at the hero's foot from 48rem, over the albums", async () => {
    const hero = within(heroOf(await renderArtist({ formFactor: FORM_FACTORS.tablet })))

    expect(hero.getByRole('button', { name: PLAYER_COPY.play })).toBeInTheDocument()
    expect(hero.getByRole('button', { name: PLAYER_COPY.shuffle })).toBeInTheDocument()
    expect(hero.getByRole('switch', { name: PLAYER_COPY.follow })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: OK_COMPUTER_TILE })).toBeInTheDocument()
  })

  it('says so when the artist is not on the server', async () => {
    mocked().music.getArtist.mockRejectedValue(new Error('No such artist.'))
    renderWithProviders({ ui: <AppRoutes />, route: ARTIST_URL })

    expect(await screen.findByText('No such artist.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
  })
})
