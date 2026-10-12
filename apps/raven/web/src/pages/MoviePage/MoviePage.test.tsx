import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings, type ItemDetails } from '@raven/core'
import { Route, Routes, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { MoviePage } from '@/pages/MoviePage/MoviePage'
import { itemDetails, library, matchedMovie } from '@/test/fixtures'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
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
  }: {
    details: ItemDetails
    route?: string
    display?: DisplaySettings
  }) => {
    spies.item.mockImplementation(async () => details)
    spies.libraries.mockImplementation(async () => [library({ id: 2, name: 'Films' })])
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
      { route, display },
    )
  }

  afterEach(() => {
    spies.item.mockReset()
    spies.libraries.mockReset()
    spies.tracks.mockReset()
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
    expect(screen.queryByRole('list', { name: 'Ratings' })).toBeNull()
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
})
