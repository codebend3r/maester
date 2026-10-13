import { describe, expect, it } from 'vitest'
import { namedAs } from '@/media/namedAs'

describe('namedAs', () => {
  it('reads an Anime movies file as a movie, waiting to be matched', () => {
    const movie = {
      fileName: 'Spirited Away (2001) Bluray-1080p.mkv',
      folder: 'Spirited Away (2001)',
    }
    expect(namedAs({ kind: 'animeMovies', ...movie })).toEqual(
      namedAs({ kind: 'movies', ...movie }),
    )
    expect(namedAs({ kind: 'animeMovies', ...movie })).toMatchObject({
      title: 'Spirited Away',
      year: 2001,
      match: 'pending',
    })
  })

  it('reads an Anime shows file as an episode, waiting to be matched', () => {
    const episode = {
      fileName: 'Frieren - (0012) S01E012 - A Real Hero.mkv',
      folder: 'Frieren (2023)/Season 01',
    }
    expect(namedAs({ kind: 'animeShows', ...episode })).toEqual(
      namedAs({ kind: 'shows', ...episode }),
    )
    expect(namedAs({ kind: 'animeShows', ...episode })).toMatchObject({
      year: 2023,
      match: 'pending',
    })
  })

  it('reads sporting events as movies, to be matched', () => {
    const file = { fileName: 'UFC 102 Couture vs Nogueira (2009) 720p.mkv', folder: '' }
    expect(namedAs({ kind: 'sports', ...file })).toEqual(namedAs({ kind: 'movies', ...file }))
    expect(namedAs({ kind: 'sports', ...file })).toMatchObject({ year: 2009, match: 'pending' })
  })

  it('leaves YouTube videos unmatched, with the tidied name', () => {
    const file = { fileName: 'UFC.324.Prelims.1080p.mkv', folder: '' }
    expect(namedAs({ kind: 'youtube', ...file })).toEqual(namedAs({ kind: 'other', ...file }))
    expect(namedAs({ kind: 'youtube', ...file })).toMatchObject({ year: null, match: 'off' })
  })
})
