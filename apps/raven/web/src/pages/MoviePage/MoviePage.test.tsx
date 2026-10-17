import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type AdminLock,
  DEFAULT_DISPLAY_SETTINGS,
  type DisplaySettings,
  type ItemDetails,
  type Library,
} from '@raven/core'
import { Route, Routes, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { MoviePage } from '@/pages/MoviePage/MoviePage'
import { itemDetails, library, matchedMovie } from '@/test/fixtures'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const Watching = () => <p>Watching {useParams().id}</p>

describe('MoviePage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    libraries: spyOn(api, 'listLibraries'),
    tracks: spyOn(api, 'getTracks'),
  }

  const open = ({
    details,
    route = '/movies/40',
    display = DEFAULT_DISPLAY_SETTINGS,
    adminLock,
    libraries = [library({ id: 2, name: 'Films' })],
  }: {
    details: ItemDetails
    route?: string
    display?: DisplaySettings
    adminLock?: AdminLock
    libraries?: Library[]
  }) => {
    spies.item.mockImplementation(async () => details)
    spies.libraries.mockImplementation(async () => libraries)
    spies.tracks.mockImplementation(async () => ({
      audio: [{ index: 0, codec: 'eac3', channels: 6, language: 'en', title: null, default: true }],
      subtitles: [
        {
          id: 'embedded-0',
          source: 'embedded',
          codec: 'subrip',
          language: 'en',
          title: null,
          default: false,
          forced: false,
          hearingImpaired: false,
          supported: true,
        },
        {
          id: 'embedded-1',
          source: 'embedded',
          codec: 'subrip',
          language: 'es',
          title: null,
          default: false,
          forced: false,
          hearingImpaired: false,
          supported: true,
        },
      ],
      defaultAudio: 0,
      frameRate: 24,
    }))
    renderWithProviders(
      <Routes>
        <Route path="movies/:id" element={<MoviePage />} />
        <Route path="watch/:id" element={<Watching />} />
      </Routes>,
      { route, display, adminLock },
    )
  }

  afterEach(() => {
    cleanup()
    spies.item.mockReset()
    spies.libraries.mockReset()
    spies.tracks.mockReset()
  })

  it('stands in for the movie while it is read, saying so to a screen reader', async () => {
    spies.item.mockImplementation(() => held<ItemDetails>().promise)
    renderWithProviders(
      <Routes>
        <Route path="movies/:id" element={<MoviePage />} />
      </Routes>,
      { route: '/movies/40' },
    )
    expect(await screen.findByText('Opening the movie')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('shows the header: title, director, content rating, facts and the TMDB score', async () => {
    open({ details: itemDetails() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Busboys' })).toBeInTheDocument()
    expect(screen.getByText('Directed by Mark Kimball')).toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
    expect(screen.getByText('1h 37m')).toBeInTheDocument()
    expect(screen.getByText('Crime')).toBeInTheDocument()
    expect(screen.queryByText('Romance')).toBeNull()
    expect(screen.getByRole('listitem', { name: 'TMDB audience score, 82%' })).toBeInTheDocument()
    expect(screen.getByText('Every table has a story.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Films' })).toHaveAttribute('href', '/libraries/2')
  })

  it('shows all four scores, marking the sources that have none for the movie', async () => {
    open({ details: itemDetails() })
    const ratings = await screen.findByRole('list', { name: 'Ratings' })
    expect(
      within(ratings)
        .getAllByRole('listitem')
        .map((chip) => chip.getAttribute('aria-label')),
    ).toEqual([
      'Rotten Tomatoes: no score',
      'IMDb: no score',
      'Metacritic: no score',
      'TMDB audience score, 82%',
    ])
  })

  it('says nothing of a version the server converts for this browser', async () => {
    setBrowserSupport((mime) => !mime.includes('ec-3'))
    setStreamSupport(() => true)
    open({ details: itemDetails({ versions: [matchedMovie({ audioCodec: 'eac3' })] }) })
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.queryByText('Converted on the server')).toBeNull()
    expect(screen.queryByText("Won't play in this browser")).toBeNull()
  })

  it('warns when this browser cannot play the version Play starts at all', async () => {
    setBrowserSupport((mime) => !mime.includes('ec-3'))
    open({ details: itemDetails({ versions: [matchedMovie({ audioCodec: 'eac3' })] }) })
    expect(await screen.findByText("Won't play in this browser")).toBeInTheDocument()
  })

  it('plays from its poster', async () => {
    open({ details: itemDetails() })
    const poster = await screen.findByRole('link', { name: 'Play Busboys' })
    expect(poster.querySelector('img')).not.toBeNull()
    await userEvent.click(poster)
    expect(await screen.findByText('Watching 7')).toBeInTheDocument()
  })

  it("describes the file's video, audio and subtitles", async () => {
    open({ details: itemDetails() })
    expect(await screen.findByText('English (Dolby Digital Plus 5.1)')).toBeInTheDocument()
    expect(screen.getByText('1080p (HEVC)')).toBeInTheDocument()
    expect(screen.getByText('English, Spanish')).toBeInTheDocument()
  })

  it("lists the file's container, bitrate and size after its tracks", async () => {
    open({ details: itemDetails() })
    const file = await screen.findByRole('region', { name: 'File' })
    expect(
      within(file)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Video', 'Audio', 'Subtitles', 'Container', 'Bitrate', 'Size'])
    expect(within(file).getByText('MKV')).toBeInTheDocument()
    expect(within(file).getByText('2.2 Mb/s')).toBeInTheDocument()
    expect(within(file).getByText('1.6 GB')).toBeInTheDocument()
  })

  it('fills the heart of a favourite, and favours one that is not', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setFavourite').mockImplementation(async (input) => {
      calls.push(input)
      return matchedMovie({ favourite: input.favourite })
    })
    open({ details: itemDetails({ versions: [matchedMovie({ favourite: true })] }) })
    const heart = await screen.findByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(heart)
    set.mockRestore()
    expect(calls).toEqual([{ id: 7, favourite: false }])
  })

  it('describes untagged audio without a language', async () => {
    open({ details: itemDetails() })
    spies.tracks.mockImplementation(async () => ({
      audio: [{ index: 0, codec: 'ac3', channels: 1, language: null, title: null, default: true }],
      subtitles: [],
      defaultAudio: 0,
      frameRate: 24,
    }))
    expect(await screen.findByText('Dolby Digital Mono')).toBeInTheDocument()
  })

  it('is not found at the address of an item that is not a movie', async () => {
    open({ details: itemDetails({ type: 'episode', title: 'Half Loop' }) })
    expect(
      await screen.findByRole('heading', { name: 'Nothing lives at this address' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Half Loop' })).toBeNull()
  })

  it('plays, or resumes from the saved spot', async () => {
    open({ details: itemDetails({ versions: [matchedMovie({ position: 2530 })] }) })
    await userEvent.click(await screen.findByRole('link', { name: 'Resume from 42:10' }))
    expect(screen.getByText('Watching 7')).toBeInTheDocument()
  })

  it('plays the file a split card names', async () => {
    const details = itemDetails({
      versions: [
        matchedMovie({ id: 8, width: 3840, height: 2160, fileName: 'Busboys 2160p.mkv' }),
        matchedMovie({ id: 7 }),
      ],
    })
    open({ details, route: '/movies/40?file=7' })
    await userEvent.click(await screen.findByRole('link', { name: 'Play Busboys' }))
    expect(await screen.findByText('Watching 7')).toBeInTheDocument()
  })

  it('plays the best file when the address names a file that is not the movie’s', async () => {
    open({
      details: itemDetails({
        versions: [
          matchedMovie({ id: 8, width: 3840, height: 2160, fileName: 'Busboys 2160p.mkv' }),
          matchedMovie({ id: 7 }),
        ],
      }),
      route: '/movies/40?file=99',
    })
    await userEvent.click(await screen.findByRole('link', { name: 'Play Busboys' }))
    expect(await screen.findByText('Watching 8')).toBeInTheDocument()
  })

  it("shows the title as the movie's logo", async () => {
    open({ details: itemDetails({ logoVersion: 'abc' }) })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(heading.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/images/logo'),
    )
  })

  it('spells the title out when Settings says Text', async () => {
    open({ details: itemDetails({ logoVersion: 'abc' }), display: { titles: 'text' } })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(heading.querySelector('img')).toBeNull()
  })

  it('opens Edit images from the header, and closes it with Done', async () => {
    const images = spyOn(api, 'getItemImages').mockImplementation(async () => ({
      poster: [],
      backdrop: [],
      logo: [],
    }))
    open({ details: itemDetails() })
    const button = await screen.findByRole('button', { name: 'Edit images' })
    expect(screen.queryByRole('heading', { name: 'Edit images' })).toBeNull()
    await userEvent.click(button)
    expect(await screen.findByRole('heading', { name: 'Edit images' })).toBeInTheDocument()
    expect(images).toHaveBeenCalledWith(40)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('heading', { name: 'Edit images' })).toBeNull()
    images.mockRestore()
  })

  it("leaves Edit images, Edit metadata and the file's menu out while the admin lock is on", async () => {
    open({ details: itemDetails(), adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('button', { name: 'Favourite' })).toBeInTheDocument()
    expect(
      screen.queryAllByRole('button', { name: /^(Edit images|Edit metadata|Options for .+)$/ }),
    ).toEqual([])
  })

  it('opens Edit metadata from the header', async () => {
    const state = spyOn(api, 'getItemMetadata').mockImplementation(async () => ({
      shown: { title: 'The Matrix', year: 1999, tagline: null, summary: null, contentRating: null },
      original: {
        title: 'The Matrix',
        year: 1999,
        tagline: null,
        summary: null,
        contentRating: null,
      },
      overridden: [],
    }))
    open({ details: itemDetails() })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit metadata' }))
    expect(await screen.findByRole('heading', { name: 'Edit metadata' })).toBeInTheDocument()
    expect(state).toHaveBeenCalledWith(40)
    state.mockRestore()
  })

  it('lists the versions only when there is more than one', async () => {
    open({ details: itemDetails() })
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.queryByRole('heading', { name: 'Versions' })).toBeNull()
    expect(screen.queryByText(/^\d+ files?$/)).toBeNull()
  })

  it('counts its files among the facts once there are two or more', async () => {
    open({
      details: itemDetails({ versions: [matchedMovie({ id: 8 }), matchedMovie({ id: 7 })] }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.getByText('2 files')).toBeInTheDocument()
  })

  it('lists every version, each playable', async () => {
    open({
      details: itemDetails({
        versions: [
          matchedMovie({ id: 8, width: 3840, height: 2160, fileName: 'Busboys 2160p.mkv' }),
          matchedMovie({ id: 7 }),
        ],
      }),
    })
    const versions = await screen.findByRole('heading', { name: 'Versions' })
    const section = versions.closest('section') ?? document.body
    expect(within(section).getByRole('link', { name: 'Play Busboys 2160p.mkv' })).toHaveAttribute(
      'href',
      '/watch/8',
    )
    expect(await within(section).findAllByText('Films')).toHaveLength(2)
  })

  describe('in two libraries', () => {
    const LIBRARIES = [library({ id: 2, name: '4K Films' }), library({ id: 3, name: 'Films' })]
    // Best first, as the server lists them: the 4K library's two, then the other's two.
    const AVATAR = itemDetails({
      versions: [
        matchedMovie({ id: 8, width: 3840, height: 2160, fileName: 'Busboys Extended 2160p.mkv' }),
        matchedMovie({ id: 6, width: 3840, height: 2160, fileName: 'Busboys 2160p.mkv' }),
        matchedMovie({ id: 7, libraryId: 3, fileName: 'Busboys 1080p.mkv' }),
        matchedMovie({ id: 5, libraryId: 3, fileName: 'Busboys Remux 1080p.mkv' }),
      ],
    })

    const played = async () => {
      const versions = await screen.findByRole('heading', { name: 'Versions' })
      const section = versions.closest('section') ?? document.body
      return within(section)
        .getAllByRole('link', { name: /^Play / })
        .map((link) => link.getAttribute('href'))
    }

    it('shows only the files of the library the address names, never mixing in the other', async () => {
      open({ details: AVATAR, libraries: LIBRARIES, route: '/movies/40?library=3' })
      expect(await played()).toEqual(['/watch/7', '/watch/5'])
      expect(screen.getByText('2 files')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Films' })).toHaveAttribute('href', '/libraries/3')
      await userEvent.click(screen.getByRole('link', { name: 'Play Busboys' }))
      expect(await screen.findByText('Watching 7')).toBeInTheDocument()
    })

    it('keeps to the library of the file a split card names, or of the best file, when the address names none', async () => {
      open({ details: AVATAR, libraries: LIBRARIES, route: '/movies/40?file=5' })
      expect(await played()).toEqual(['/watch/7', '/watch/5'])
      await userEvent.click(screen.getByRole('link', { name: 'Play Busboys' }))
      expect(await screen.findByText('Watching 5')).toBeInTheDocument()
    })

    it('keeps to the library of the best file for an address naming no library, or one without the movie', async () => {
      open({ details: AVATAR, libraries: LIBRARIES, route: '/movies/40?library=9' })
      expect(await played()).toEqual(['/watch/8', '/watch/6'])
      expect(screen.getByRole('link', { name: '4K Films' })).toHaveAttribute('href', '/libraries/2')
    })
  })

  it('leaves out what TMDB did not give', async () => {
    open({
      details: itemDetails({
        tagline: null,
        summary: null,
        contentRating: null,
        ratings: [],
        credits: [],
        genres: [],
      }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
    // Every source still has its chip, each saying it has no score.
    expect(
      within(screen.getByRole('list', { name: 'Ratings' })).getAllByRole('listitem', {
        name: /no score/,
      }),
    ).toHaveLength(4)
    expect(screen.queryByRole('heading', { name: 'Cast & Crew' })).toBeNull()
    expect(screen.queryByText(/Directed by/)).toBeNull()
  })

  it('clamps a long summary behind More', async () => {
    open({ details: itemDetails({ summary: 'A long night at the steakhouse. '.repeat(12) }) })
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it("carries TMDB's attribution", async () => {
    open({ details: itemDetails() })
    expect(
      await screen.findByText(
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      ),
    ).toBeInTheDocument()
  })

  it('says the movie was matched by AI, and why', async () => {
    open({
      details: itemDetails({
        aiMatch: { reason: 'The title and year fit, and no other result does.' },
      }),
    })
    const note = await screen.findByText('Matched by AI.')
    expect(note.closest('p')).toHaveTextContent(
      'Matched by AI. The title and year fit, and no other result does.',
    )
  })

  it('says nothing of AI for a movie a search or Fix match matched', async () => {
    open({ details: itemDetails() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Busboys' })).toBeInTheDocument()
    expect(screen.queryByText('Matched by AI.')).toBeNull()
  })

  it('shows Watched pressed for a watched movie and sends a media target when pressed', async () => {
    const calls: unknown[] = []
    const set = spyOn(api, 'setWatched').mockImplementation(async (input) => {
      calls.push(input)
    })
    open({ details: itemDetails({ versions: [matchedMovie({ watched: true })] }) })
    const toggle = await screen.findByRole('button', { name: 'Watched' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    set.mockRestore()
    expect(calls).toEqual([{ watched: false, targets: [{ kind: 'media', id: 7 }] }])
  })

  it('shows Watched unpressed for a movie not yet watched, and keeps it with the admin lock on', async () => {
    open({ details: itemDetails(), adminLock: { state: 'on', available: true } })
    expect(await screen.findByRole('button', { name: 'Watched' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
