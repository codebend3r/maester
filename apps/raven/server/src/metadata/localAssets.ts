import { readdir } from 'node:fs/promises'
import { SCAN_FILESYSTEM } from '@/scanner/walk'

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i

/** A folder's file names, read through the scan's filesystem gate; none when it cannot be read. */
export const listFolder = (dir: string): Promise<string[]> =>
  SCAN_FILESYSTEM.run(() => readdir(dir).catch((): string[] => []))

const stemOf = (name: string): string => name.slice(0, name.lastIndexOf('.')).toLowerCase()

/** The first of `stems`, in order, that names an image in `names`. */
const firstImage = ({ names, stems }: { names: readonly string[]; stems: readonly string[] }) =>
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

/**
 * A movie's pictures and NFO among its folder's file names. Names tied to the
 * file (`<stem>-poster`, `<stem>.nfo`) always count; the folder's own
 * (`poster`, `fanart`, `movie.nfo`) only when the folder holds this one
 * movie, so a `folder.jpg` at a library's root is not every movie's poster.
 */
export const movieAssets = ({
  names,
  stem,
  ownFolder,
}: {
  names: readonly string[]
  stem: string
  ownFolder: boolean
}): MovieAssets => ({
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
