import {
  type ApiClient,
  type Library,
  MUSIC_PAGE,
  MUSIC_SORTS,
  type Track,
  randomMusicSeed,
} from '@raven/core'

type ShuffledTracksOfProps = {
  api: Pick<ApiClient, 'listTracks'>
  /** The music libraries to deal from. */
  libraries: readonly Pick<Library, 'id'>[]
}

/**
 * A random page of each music library, for Shuffle all: every song at once would be too many to
 * queue. The seed is new each call, so each deals other songs; with none the server's is always 0.
 */
export const shuffledTracksOf = async ({
  api,
  libraries,
}: ShuffledTracksOfProps): Promise<Track[]> => {
  const seed = randomMusicSeed()
  const pages = await Promise.all(
    libraries.map((library) =>
      api.listTracks({
        libraryId: library.id,
        sort: MUSIC_SORTS.random,
        seed,
        limit: MUSIC_PAGE.most,
        offset: 0,
      }),
    ),
  )
  return pages.flatMap((page) => page.tracks)
}
