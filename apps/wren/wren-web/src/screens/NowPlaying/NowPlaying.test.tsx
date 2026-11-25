import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AUDIO_BITRATES, REPEAT_MODES, artistNames } from '@raven/core'
import { useAudioQueue, usePlayerPrefs } from '@raven/ui/headless'
import { KIT_COPY, NOW_PLAYING_COPY, PLAYER_COPY, STATUS_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { WREN_ROUTES, artistPath } from '@/routes'
import { NowPlaying } from '@/screens/NowPlaying/NowPlaying'
import { AIRBAG, AUDIOBOOKS, PARANOID, RADIOHEAD, mockMusicApiEach, trackFor } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

type QueueActions = ReturnType<typeof useAudioQueue.getState>

const EXIT_MUSIC = trackFor({ id: 104, title: 'Exit Music', number: 4 })

const HOME_MARK = 'Home is showing'
const ARTIST_MARK = 'The artist is showing'

const OUTPUT = NOW_PLAYING_COPY.output({
  server: STATUS_COPY.raven,
  device: NOW_PLAYING_COPY.devices.browser,
})

type OpenNowPlayingProps = { formFactor?: FormFactor }

/** Now Playing opened over Home, as a press on the mini player opens it. */
const openNowPlaying = ({ formFactor = FORM_FACTORS.phone }: OpenNowPlayingProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<p>{HOME_MARK}</p>} path={WREN_ROUTES.home} />
        <Route element={<p>{ARTIST_MARK}</p>} path={WREN_ROUTES.artist} />
        <Route element={<NowPlaying />} path={WREN_ROUTES.nowPlaying} />
      </Routes>
    ),
    behind: [WREN_ROUTES.home],
    route: WREN_ROUTES.nowPlaying,
    formFactor,
  })

const rowNamed = (title: string) =>
  screen.getByRole('button', {
    name: NOW_PLAYING_COPY.entry({ title, line: artistNames(AIRBAG) }),
  })

const qualityNamed = (line: string) =>
  KIT_COPY.labelled({ label: NOW_PLAYING_COPY.quality, value: line })

type ActionNamedProps = { action: string; title: string }

const actionNamed = ({ action, title }: ActionNamedProps) =>
  screen.getByRole('button', { name: KIT_COPY.labelled({ label: action, value: title }) })

describe('Now Playing', () => {
  const seekTo = mock<QueueActions['seekTo']>()
  const move = mock<QueueActions['move']>()
  const remove = mock<QueueActions['remove']>()
  const jump = mock<QueueActions['jump']>()
  const music = mockMusicApiEach()

  beforeEach(() => {
    seekTo.mockClear()
    move.mockClear()
    remove.mockClear()
    jump.mockClear()
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, EXIT_MUSIC] })
    useAudioQueue.setState({ seekTo, move, remove, jump })
  })

  it('shows the playing song, where it plays from, and where it plays', async () => {
    openNowPlaying()
    expect(await screen.findByRole('heading', { name: 'Airbag' })).toBeInTheDocument()
    expect(screen.getByText(NOW_PLAYING_COPY.from.other)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: OUTPUT, pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: PLAYER_COPY.position })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: PLAYER_COPY.volume })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: NOW_PLAYING_COPY.speedOf(1.5) })).toBeNull()
  })

  it("draws the file's format and bit depth as chips once the host has a source for it", async () => {
    openNowPlaying()
    expect(
      await screen.findByRole('note', {
        name: qualityNamed('FLAC · 16-bit / 44.1 kHz · 900 kbps'),
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('FLAC')).toBeInTheDocument()
    expect(screen.getByText('16-bit')).toBeInTheDocument()
    expect(screen.getByText('44.1 kHz · 900 kbps')).toBeInTheDocument()
  })

  it('says the transcode that plays when the listener picked one', async () => {
    usePlayerPrefs.getState().setMusicQuality(AUDIO_BITRATES.standard)
    openNowPlaying()
    expect(
      await screen.findByRole('note', { name: qualityNamed('AAC · 256 kbps') }),
    ).toBeInTheDocument()
    expect(screen.getByText('AAC')).toBeInTheDocument()
  })

  it('keeps Previous, Play or Pause and Next alone under the scrubber', async () => {
    openNowPlaying()
    expect(await screen.findByRole('button', { name: PLAYER_COPY.previous })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: PLAYER_COPY.next })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.shuffle })).toBeNull()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] })).toBeNull()
  })

  it('shows the time played and the time left, with a minus, under the scrubber', async () => {
    useAudioQueue.setState({ position: 62, duration: 300 })
    openNowPlaying()
    expect(await screen.findByText('1:02')).toBeInTheDocument()
    expect(screen.getByText('-3:58')).toBeInTheDocument()
  })

  it('turns the song off as a favourite from the heart beside its name', async () => {
    const user = userEvent.setup()
    const setFavourite = spyOn(api, 'setFavourite').mockImplementation(
      () => new Promise(() => undefined),
    )
    openNowPlaying()
    const heart = await screen.findByRole('button', {
      name: TRACK_MENU_COPY.likeSong(AIRBAG.title),
      pressed: true,
    })
    await user.click(heart)
    expect(setFavourite).toHaveBeenCalledWith({ id: AIRBAG.id, favourite: false })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    setFavourite.mockRestore()
  })

  it("opens the listener's playlists from Add to playlist beside the song's name", async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: NOW_PLAYING_COPY.addToPlaylist }))
    const picker = await screen.findByRole('dialog', { name: TRACK_MENU_COPY.addToPlaylistTitle })
    expect(
      await within(picker).findByRole('list', { name: TRACK_MENU_COPY.pickPlaylist(AIRBAG.title) }),
    ).toBeInTheDocument()
    expect(screen.queryByText(TRACK_MENU_COPY.playNext)).toBeNull()
  })

  it('shuffles, repeats and clears the queue from Up next', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    await user.click(screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] }))
    expect(
      screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.all] }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('shows the lyrics, and seeks to a synced line that is pressed', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.lyrics }))
    await user.click(await screen.findByRole('button', { name: 'In a jackknifed juggernaut' }))
    expect(seekTo).toHaveBeenCalledWith(12)
    expect(screen.getByRole('button', { name: NOW_PLAYING_COPY.instrumental })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: PLAYER_COPY.lyrics }))
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
  })

  it('marks the line being sung', async () => {
    const user = userEvent.setup()
    useAudioQueue.setState({ position: 13 })
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.lyrics }))
    expect(
      await screen.findByRole('button', { name: 'In a jackknifed juggernaut', current: true }),
    ).toBeInTheDocument()
  })

  it('says when a song has no lyrics', async () => {
    const user = userEvent.setup()
    music().getLyrics.mockRejectedValue(new Error('no lyrics'))
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.lyrics }))
    expect(await screen.findByText(NOW_PLAYING_COPY.noLyrics)).toBeInTheDocument()
  })

  it('lists what plays next, which plays, moves and goes by its buttons', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    expect(await screen.findByRole('heading', { name: PLAYER_COPY.upNext })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Airbag, / })).toBeNull()
    await user.click(rowNamed('Exit Music'))
    expect(jump).toHaveBeenCalledWith(2)
    await user.click(actionNamed({ action: NOW_PLAYING_COPY.moveDown, title: 'Paranoid Android' }))
    expect(move).toHaveBeenCalledWith({ from: 1, to: 2 })
    await user.click(actionNamed({ action: NOW_PLAYING_COPY.moveUp, title: 'Exit Music' }))
    expect(move).toHaveBeenCalledWith({ from: 2, to: 1 })
    await user.click(actionNamed({ action: NOW_PLAYING_COPY.remove, title: 'Paranoid Android' }))
    expect(remove).toHaveBeenCalledWith(1)
  })

  it('offers no move past either end of what plays next', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    expect(
      actionNamed({ action: NOW_PLAYING_COPY.moveUp, title: 'Paranoid Android' }),
    ).toBeDisabled()
    expect(actionNamed({ action: NOW_PLAYING_COPY.moveDown, title: 'Exit Music' })).toBeDisabled()
  })

  it('says when nothing else is queued', async () => {
    const user = userEvent.setup()
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: PLAYER_COPY.upNext }))
    expect(await screen.findByText(NOW_PLAYING_COPY.nothingNext)).toBeInTheDocument()
  })

  it('lays the player beside a pane that opens on Up next, in a wide window', async () => {
    const user = userEvent.setup()
    openNowPlaying({ formFactor: FORM_FACTORS.tablet })
    expect(await screen.findByRole('heading', { name: 'Airbag' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: PLAYER_COPY.upNext })).toBeChecked()
    expect(screen.getByRole('heading', { name: PLAYER_COPY.upNext })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'In a jackknifed juggernaut' })).toBeNull()
    expect(
      screen.getByText(NOW_PLAYING_COPY.playingOn(NOW_PLAYING_COPY.devices.browser)),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: OUTPUT })).toBeNull()
    expect(screen.getByRole('button', { name: PLAYER_COPY.shuffle })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: PLAYER_COPY.repeat[REPEAT_MODES.off] }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: NOW_PLAYING_COPY.clearLabel }))
    expect(remove.mock.calls).toEqual([[2], [1]])
  })

  it("swaps the wide window's pane for the lyrics from its tabs", async () => {
    const user = userEvent.setup()
    openNowPlaying({ formFactor: FORM_FACTORS.tablet })
    await user.click(await screen.findByRole('radio', { name: PLAYER_COPY.lyrics }))
    expect(
      await screen.findByRole('button', { name: 'In a jackknifed juggernaut' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PLAYER_COPY.upNext })).toBeNull()
    expect(screen.getByRole('slider', { name: PLAYER_COPY.position })).toBeInTheDocument()
  })

  it("offers an audiobook's speed, and sets it", async () => {
    const user = userEvent.setup()
    music().listLibraries.mockResolvedValue([AUDIOBOOKS])
    openNowPlaying()
    await user.click(await screen.findByRole('radio', { name: NOW_PLAYING_COPY.speedOf(1.5) }))
    expect(usePlayerPrefs.getState().audiobookSpeed).toBe(1.5)
  })

  it('sets the volume from its line', async () => {
    usePlayerPrefs.getState().setVolume({ volume: 0.5, muted: true })
    openNowPlaying()
    const volume = await screen.findByRole('slider', { name: PLAYER_COPY.volume })
    fireEvent.change(volume, { target: { value: '0.8' } })
    expect(usePlayerPrefs.getState().volume).toBe(0.8)
    expect(usePlayerPrefs.getState().muted).toBe(false)
  })

  it('closes by its button, back to the page it was opened over', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: NOW_PLAYING_COPY.close }))
    expect(await screen.findByText(HOME_MARK)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await screen.findByRole('heading', { name: 'Airbag' })
    await user.keyboard('{Escape}')
    expect(await screen.findByText(HOME_MARK)).toBeInTheDocument()
  })

  it("opens the song's first artist from its name", async () => {
    const user = userEvent.setup()
    openNowPlaying()
    const artist = await screen.findByRole('link', { name: RADIOHEAD.name })
    expect(artist).toHaveAttribute('href', artistPath(RADIOHEAD.id))
    await user.click(artist)
    expect(await screen.findByText(ARTIST_MARK)).toBeInTheDocument()
  })

  it("opens the song's menu from More", async () => {
    const user = userEvent.setup()
    openNowPlaying()
    await user.click(await screen.findByRole('button', { name: NOW_PLAYING_COPY.more }))
    expect(await screen.findByText(TRACK_MENU_COPY.playNext)).toBeInTheDocument()
  })

  it('says that nothing is playing, and still closes, with an empty queue', async () => {
    const user = userEvent.setup()
    useAudioQueue.getState().clear()
    openNowPlaying()
    expect(screen.getByText(NOW_PLAYING_COPY.nothing)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: NOW_PLAYING_COPY.close }))
    expect(await screen.findByText(HOME_MARK)).toBeInTheDocument()
  })
})
