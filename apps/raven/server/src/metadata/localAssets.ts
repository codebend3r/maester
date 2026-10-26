import { readdir } from 'node:fs/promises'
import { SCAN_FILESYSTEM } from '@/scanner/walk'

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i

/** The NFO file names raven reads, as Kodi names them. */
const NFO_NAMES = { show: 'tvshow.nfo' } as const

/** A folder's file names, read through the scan's filesystem gate; none when it cannot be read. */
export const listFolder = (dir: string): Promise<string[]> =>
  SCAN_FILESYSTEM.run(() => readdir(dir).catch((): string[] => []))

const stemOf = (name: string): string => name.slice(0, name.lastIndexOf('.')).toLowerCase()

type FirstImageProps = { names: readonly string[]; stems: readonly string[] }

/** The first of `stems`, in order, that names an image in `names`. */
const firstImage = ({ names, stems }: FirstImageProps) =>
  stems
    .map((stem) =>
      names.find((name) => IMAGE_EXTENSION.test(name) && stemOf(name) === stem.toLowerCase()),
    )
    .find((name) => name != null) ?? null

export type MovieAssets = {
  poster: string | null
  backdrop: string | null
  nfo: string | null
}

type MovieAssetsProps = {
  names: readonly string[]
  stem: string
  ownFolder: boolean
}

/**
 * A movie's pictures and NFO among its folder's file names. Names tied to the
 * file (`<stem>-poster`, `<stem>.nfo`) always count; the folder's own
 * (`poster`, `fanart`, `movie.nfo`) only when the folder holds this one
 * movie, so a `folder.jpg` at a library's root is not every movie's poster.
 */
export const movieAssets = ({ names, stem, ownFolder }: MovieAssetsProps): MovieAssets => ({
  poster: firstImage({
    names,
    stems: [`${stem}-poster`, ...(ownFolder ? ['poster', 'folder', 'cover'] : [])],
  }),
  backdrop: firstImage({
    names,
    stems: [`${stem}-fanart`, ...(ownFolder ? ['fanart', 'backdrop', 'background'] : [])],
  }),
  nfo:
    [`${stem}.nfo`, ...(ownFolder ? ['movie.nfo'] : [])]
      .map((wanted) => names.find((name) => name.toLowerCase() === wanted.toLowerCase()))
      .find((name) => name != null) ?? null,
})

export type ShowAssets = {
  poster: string | null
  backdrop: string | null
  nfo: string | null
}

/** A show's pictures and NFO among its folder's file names. */
export const showAssets = (names: readonly string[]): ShowAssets => ({
  poster: firstImage({ names, stems: ['poster', 'folder', 'show'] }),
  backdrop: firstImage({ names, stems: ['fanart', 'backdrop', 'background'] }),
  nfo: names.find((name) => name.toLowerCase() === NFO_NAMES.show) ?? null,
})

type SeasonPosterProps = {
  names: readonly string[]
  number: number
}

/** A season's poster: `Season01`, `season01-poster`, or `season-specials-poster` for season 0. */
export const seasonPoster = ({ names, number }: SeasonPosterProps): string | null => {
  const padded = String(number).padStart(2, '0')
  return firstImage({
    names,
    stems:
      number === 0
        ? ['season-specials-poster', 'season00-poster', 'Season00']
        : [
            `season${padded}-poster`,
            `Season${padded}`,
            `season${number}-poster`,
            `Season${number}`,
          ],
  })
}

type EpisodeStillProps = {
  names: readonly string[]
  stem: string
}

/** An episode's still beside it: `<stem>-thumb`. */
export const episodeStill = ({ names, stem }: EpisodeStillProps): string | null =>
  firstImage({ names, stems: [`${stem}-thumb`] })
