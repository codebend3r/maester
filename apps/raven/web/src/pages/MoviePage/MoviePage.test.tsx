import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemDetails } from '@raven/core'
import { Route, Routes, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { MoviePage } from '@/pages/MoviePage/MoviePage'
import { itemDetails, library, matchedMovie } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const Watching = () => <p>Watching {useParams().id}</p>

describe('MoviePage', () => {
  const spies = {
    item: spyOn(api, 'getItem'),
    libraries: spyOn(api, 'listLibraries'),
    tracks: spyOn(api, 'getTracks'),
  }

  const open = (details: ItemDetails) => {
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
      { route: '/movies/40' },
    )
  }

  afterEach(() => {
    spies.item.mockReset()
    spies.libraries.mockReset()
    spies.tracks.mockReset()
  })

  it('shows the header: title, director, content rating, facts and the TMDB score', async () => {
    open(itemDetails())
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

  it("describes the file's video, audio and subtitles", async () => {
    open(itemDetails())
    expect(await screen.findByText('English (Dolby Digital Plus 5.1)')).toBeInTheDocument()
    expect(screen.getByText('1080p (HEVC)')).toBeInTheDocument()
    expect(screen.getByText('English, Spanish')).toBeInTheDocument()
  })

  it('plays, or resumes from the saved spot', async () => {
    open(itemDetails({ versions: [matchedMovie({ position: 2530 })] }))
    await userEvent.click(await screen.findByRole('link', { name: 'Resume from 42:10' }))
    expect(screen.getByText('Watching 7')).toBeInTheDocument()
  })

  it('lists the versions only when there is more than one', async () => {
    open(itemDetails())
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.queryByRole('heading', { name: 'Versions' })).toBeNull()
  })

  it('lists every version, each playable', async () => {
    open(
      itemDetails({
        versions: [
          matchedMovie({ id: 8, width: 3840, height: 2160, fileName: 'Busboys 2160p.mkv' }),
          matchedMovie({ id: 7 }),
        ],
      }),
    )
    const versions = await screen.findByRole('heading', { name: 'Versions' })
    const section = versions.closest('section') ?? document.body
    expect(within(section).getByRole('link', { name: 'Play Busboys 2160p.mkv' })).toHaveAttribute(
      'href',
      '/watch/8',
    )
    expect(await within(section).findAllByText('Films')).toHaveLength(2)
  })

  it('leaves out what TMDB did not give', async () => {
    open(
      itemDetails({
        tagline: null,
        summary: null,
        contentRating: null,
        ratings: [],
        credits: [],
        genres: [],
      }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Busboys' })
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Ratings' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Cast & Crew' })).toBeNull()
    expect(screen.queryByText(/Directed by/)).toBeNull()
  })

  it('clamps a long summary behind More', async () => {
    open(itemDetails({ summary: 'A long night at the steakhouse. '.repeat(12) }))
    const more = await screen.findByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it("carries TMDB's attribution", async () => {
    open(itemDetails())
    expect(
      await screen.findByText(
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      ),
    ).toBeInTheDocument()
  })
})
