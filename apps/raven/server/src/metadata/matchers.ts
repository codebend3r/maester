import { basename, dirname, join } from 'node:path'
import {
  isExtra,
  type MatchItemType,
  type MatchState,
  parseEpisodeName,
  parseMovieName,
} from '@raven/core'
import { groupBy } from '@/groupBy'
import type { ItemPictures } from '@/metadata/itemPictures'
import { movieAssets, showAssets } from '@/metadata/localAssets'
import type { FixMatch, MatchFile, MatchFiles } from '@/metadata/matchFiles'
import type { MatchPass } from '@/metadata/matchPass'
import type { MetadataRepository } from '@/metadata/metadataRepository'
import {
  filePlace,
  holdsOneMovie,
  rootOf,
  showDirOf,
  showFolderOf,
  showPlace,
  stemOf,
} from '@/metadata/places'

/** How files are matched to one type of TMDB item: which go together, and what a Fix match covers. */
export type KindMatcher = {
  /** Pending files in the units matched together: one movie file, or one show folder's files. */
  groups: (files: readonly MatchFile[]) => MatchFile[][]
  /** Matches one unit with the pass's caches. */
  match: (args: { files: readonly MatchFile[]; pass: MatchPass }) => Promise<void>
  /** The place a Fix match on `file` is kept under, and every file it covers. */
  fixGroup: (file: MatchFile) => { place: string; files: MatchFile[] }
}

export type MatcherDeps = {
  files: MatchFiles
  metadata: MetadataRepository
  pictures: ItemPictures
}

/** Extras are never matched; the rest are what a unit is about. */
const withoutExtras = ({
  files,
  deps,
}: {
  files: readonly MatchFile[]
  deps: MatcherDeps
}): MatchFile[] => {
  const extras = files.filter((file) => isExtra(file))
  if (extras.length > 0) deps.files.setMatch({ ids: extras.map((file) => file.id), match: 'off' })
  return files.filter((file) => !isExtra(file))
}

const movieMatcher = (deps: MatcherDeps): KindMatcher => {
  /** The Fix match for a movie file: its own place first, then its folder's when that is one movie. */
  const fixFor = ({ file, own }: { file: MatchFile; own: boolean }): FixMatch => {
    const forFile = deps.files.fixMatchAt({ libraryId: file.libraryId, place: filePlace(file) })
    if (forFile.kind !== 'none' || !own) return forFile
    return deps.files.fixMatchAt({ libraryId: file.libraryId, place: file.folder })
  }

  const matchMovie = async ({ file, pass }: { file: MatchFile; pass: MatchPass }) => {
    const dir = dirname(file.path)
    const own = pass.folders.ownFolder({ libraryId: file.libraryId, folder: file.folder })
    const assets = movieAssets({
      names: await pass.folders.names(dir),
      stem: stemOf(file.fileName),
      ownFolder: own,
    })
    const parsed = parseMovieName(file)
    const resolved = await pass.resolve({
      type: 'movie',
      fix: fixFor({ file, own }),
      ids: parsed.ids,
      nfoPath: assets.nfo == null ? null : join(dir, assets.nfo),
      // When the name finds nothing, its other readings are tried: the file's
      // own name where its folder is misnamed, as with a show.
      titles: [{ title: file.title, year: file.year }, ...parsed.alternatives],
    })
    if (resolved.kind === 'unmatched') {
      deps.files.settle({ ids: [file.id], itemIds: [], match: 'unmatched' })
      return
    }
    deps.files.settle({ ids: [file.id], itemIds: [resolved.itemId], match: resolved.match })
    await deps.pictures.syncLocal({ itemIds: [resolved.itemId], folders: pass.folders })
    deps.pictures.warmPoster(resolved.itemId)
  }

  return {
    groups: (files) => files.map((file) => [file]),
    match: async ({ files, pass }) => {
      await withoutExtras({ files, deps }).reduce(
        (previous, file) => previous.then(() => matchMovie({ file, pass })),
        Promise.resolve(),
      )
    },
    fixGroup: (file) => {
      const inFolder =
        file.folder === ''
          ? []
          : deps.files.inFolder({ libraryId: file.libraryId, folder: file.folder })
      const own = holdsOneMovie({ folder: file.folder, files: inFolder })
      return own
        ? { place: file.folder, files: inFolder.filter((each) => !isExtra(each)) }
        : { place: filePlace(file), files: [file] }
    },
  }
}

/** The show a group of files is in, as each of its files is placed. */
type ShowContext = {
  showId: number
  showTmdbId: string
  fallbackShow: string
  match: MatchState
}

const showMatcher = (deps: MatcherDeps): KindMatcher => {
  /** Links one file to its episode (or episodes), making the season and episode when TMDB has none. The items it touched. */
  const placeEpisode = async ({
    file,
    show,
    pass,
  }: {
    file: MatchFile
    show: ShowContext
    pass: MatchPass
  }): Promise<number[]> => {
    const parsed = parseEpisodeName({ ...file, fallbackShow: show.fallbackShow })
    if (parsed.season == null) {
      deps.files.settle({ ids: [file.id], itemIds: [show.showId], match: show.match })
      return []
    }
    const season = await pass.ensureSeason({
      showId: show.showId,
      showTmdbId: show.showTmdbId,
      number: parsed.season,
    })
    if (parsed.episodes.length === 0) {
      deps.files.settle({ ids: [file.id], itemIds: [season.id], match: show.match })
      return [season.id]
    }
    const episodeIds = await parsed.episodes.reduce<Promise<number[]>>(
      (previous, number) =>
        previous.then(async (ids) => [
          ...ids,
          await pass.episodeFor({
            season,
            showId: show.showId,
            showTmdbId: show.showTmdbId,
            number,
            title: parsed.title,
          }),
        ]),
      Promise.resolve([]),
    )
    deps.files.settle({ ids: [file.id], itemIds: episodeIds, match: show.match })
    return [season.id, ...episodeIds]
  }

  /**
   * The files of one show folder (or one file at a root): the show is found
   * once, then each file is placed in its season and episode.
   */
  const matchShowGroup = async ({
    files,
    pass,
  }: {
    files: readonly MatchFile[]
    pass: MatchPass
  }): Promise<void> => {
    const episodes = withoutExtras({ files, deps })
    const [first] = episodes
    if (!first) return
    const ids = episodes.map((file) => file.id)
    const fallbackShow = basename(rootOf(first))
    const showDir = showDirOf(first)
    const assets = showAssets(await pass.folders.names(showDir))
    const parsed = parseEpisodeName({ ...first, fallbackShow })
    const narrowing = { year: parsed.year, country: parsed.country }
    const resolved = await pass.resolve({
      type: 'show',
      fix: deps.files.fixMatchAt({ libraryId: first.libraryId, place: showPlace(first) }),
      ids: parsed.ids,
      nfoPath: assets.nfo == null ? null : join(showDir, assets.nfo),
      // The folder names the show first; when that finds nothing, the file's
      // own name is tried, as a folder is misspelt more often than every file.
      titles: [
        { title: parsed.show, ...narrowing },
        ...(parsed.showFromFile == null ? [] : [{ title: parsed.showFromFile, ...narrowing }]),
      ],
    })
    if (resolved.kind === 'unmatched') {
      deps.files.settle({ ids, itemIds: [], match: 'unmatched' })
      return
    }
    const show: ShowContext = {
      showId: resolved.itemId,
      showTmdbId: resolved.tmdbId,
      fallbackShow,
      match: resolved.match,
    }
    const touched = await episodes.reduce<Promise<number[]>>(
      (previous, file) =>
        previous.then(async (items) => [...items, ...(await placeEpisode({ file, show, pass }))]),
      Promise.resolve([]),
    )
    await deps.pictures.syncLocal({ itemIds: [show.showId, ...touched], folders: pass.folders })
    deps.pictures.warmPoster(show.showId)
  }

  return {
    groups: (files) => [...groupBy({ items: [...files], key: showPlace }).values()],
    match: matchShowGroup,
    fixGroup: (file) => {
      const showFolder = showFolderOf(file)
      return {
        place: showPlace(file),
        files:
          showFolder == null
            ? [file]
            : deps.files.underFolder({ libraryId: file.libraryId, folder: showFolder }),
      }
    },
  }
}

/** How files are matched to movies and to shows; a library's type says which its files are. */
export const createMatchers = (deps: MatcherDeps): Record<MatchItemType, KindMatcher> => ({
  movie: movieMatcher(deps),
  show: showMatcher(deps),
})
