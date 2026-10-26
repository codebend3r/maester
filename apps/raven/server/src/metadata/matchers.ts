import { basename, dirname, join } from 'node:path'
import {
  isExtra,
  ITEM_TYPES,
  MATCH_STATES,
  type MatchItemType,
  type MatchState,
  type ParsedEpisodeName,
  type ParsedMovieName,
  parseEpisodeName,
  parseMovieName,
  showFolderOf,
} from '@raven/core'
import { groupBy } from '@/groupBy'
import type { AiDecisions } from '@/metadata/aiDecisions'
import type { ItemPictures } from '@/metadata/itemPictures'
import { movieAssets, showAssets } from '@/metadata/localAssets'
import {
  FIX_MATCH_KINDS,
  type FixMatch,
  type MatchFile,
  type MatchFiles,
} from '@/metadata/matchFiles'
import { type MatchPass, RESOLVED_KINDS, type SearchTitle } from '@/metadata/matchPass'
import type { MetadataRepository } from '@/metadata/metadataRepository'
import { filePlace, holdsOneMovie, rootOf, showDirOf, showPlace, stemOf } from '@/metadata/places'

type MatchProps = { files: readonly MatchFile[]; pass: MatchPass }

/** How files are matched to one type of TMDB item: which go together, and what a Fix match covers. */
export type KindMatcher = {
  /** Files in the units matched together: one movie file, or one show folder's files. */
  groups: (files: readonly MatchFile[]) => MatchFile[][]
  /**
   * Matches one unit with the pass's caches. A file already linked keeps its
   * links until `settle` replaces them, so one that fails midway keeps its
   * card; a show folder that fails part way through waits, pending, to be
   * matched whole.
   */
  match: (args: MatchProps) => Promise<void>
  /** The place a Fix match on `file` is kept under, and every file it covers. */
  fixGroup: (file: MatchFile) => { place: string; files: MatchFile[] }
}

export type MatcherDeps = {
  files: MatchFiles
  metadata: MetadataRepository
  pictures: ItemPictures
  /** The AI lookup's decisions, whose sure pick a group takes when its own search finds nothing. */
  decisions: AiDecisions
}

type WithoutExtrasProps = {
  files: readonly MatchFile[]
  deps: MatcherDeps
}

/** Extras are never matched; the rest are what a unit is about. */
const withoutExtras = ({ files, deps }: WithoutExtrasProps): MatchFile[] => {
  const extras = files.filter((file) => isExtra(file))
  if (extras.length > 0) deps.files.setMatch({ ids: extras.map((file) => file.id), match: 'off' })
  return files.filter((file) => !isExtra(file))
}

/** A show folder's first file as matching reads it: a file at a root falls back to the folder its titles sit in. */
export const readShowFile = (first: MatchFile): ParsedEpisodeName =>
  parseEpisodeName({ ...first, fallbackShow: basename(rootOf(first)) })

/**
 * The titles a show folder is searched by, in turn: the folder's name; the
 * file's own, as a folder is misspelt more often than every file; and the
 * folder's without an annotation that reads as an edition, as shows have
 * none: "Dragon Ball Z (Uncut)".
 */
export const showSearchTitles = (parsed: ParsedEpisodeName): SearchTitle[] => {
  const narrowing = { year: parsed.year, country: parsed.country }
  return [
    { title: parsed.show, ...narrowing },
    ...(parsed.showFromFile == null ? [] : [{ title: parsed.showFromFile, ...narrowing }]),
    ...(parsed.showWithoutEdition == null
      ? []
      : [{ title: parsed.showWithoutEdition, ...narrowing }]),
  ]
}

type MovieSearchTitlesProps = {
  file: Pick<MatchFile, 'title' | 'year'>
  parsed: ParsedMovieName
}

/**
 * The titles a movie file is searched by, in turn: its name's title and
 * year, then the name's other readings, such as the file's own name where
 * its folder is misnamed.
 */
export const movieSearchTitles = ({ file, parsed }: MovieSearchTitlesProps): SearchTitle[] => [
  { title: file.title, year: file.year },
  ...parsed.alternatives,
]

const movieMatcher = (deps: MatcherDeps): KindMatcher => {
  type FixForProps = { file: MatchFile; own: boolean }

  /** The Fix match for a movie file: its own place first, then its folder's when that is one movie. */
  const fixFor = ({ file, own }: FixForProps): FixMatch => {
    const forFile = deps.files.fixMatchAt({ libraryId: file.libraryId, place: filePlace(file) })
    if (forFile.kind !== FIX_MATCH_KINDS.none || !own) return forFile
    return deps.files.fixMatchAt({ libraryId: file.libraryId, place: file.folder })
  }

  type DecidedForProps = { file: MatchFile; own: boolean }

  /** A sure AI pick for a movie file: kept at its own place, or at its folder's when that is one movie. */
  const decidedFor = ({ file, own }: DecidedForProps): string | null =>
    deps.decisions.highPickAt({ libraryId: file.libraryId, place: filePlace(file) }) ??
    (own ? deps.decisions.highPickAt({ libraryId: file.libraryId, place: file.folder }) : null)

  type MatchMovieProps = { file: MatchFile; pass: MatchPass }

  const matchMovie = async ({ file, pass }: MatchMovieProps) => {
    const dir = dirname(file.path)
    const own = pass.folders.ownFolder({ libraryId: file.libraryId, folder: file.folder })
    const assets = movieAssets({
      names: await pass.folders.names(dir),
      stem: stemOf(file.fileName),
      ownFolder: own,
    })
    const parsed = parseMovieName(file)
    const resolved = await pass.resolve({
      type: ITEM_TYPES.movie,
      fix: fixFor({ file, own }),
      ids: parsed.ids,
      nfoPath: assets.nfo == null ? null : join(dir, assets.nfo),
      titles: movieSearchTitles({ file, parsed }),
      decided: decidedFor({ file, own }),
    })
    if (resolved.kind === RESOLVED_KINDS.unmatched) {
      deps.files.settle({ ids: [file.id], itemIds: [], match: MATCH_STATES.unmatched })
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
  type PlaceEpisodeProps = {
    file: MatchFile
    show: ShowContext
    pass: MatchPass
  }

  /** Links one file to its episode (or episodes), making the season and episode when TMDB has none. The items it touched. */
  const placeEpisode = async ({ file, show, pass }: PlaceEpisodeProps): Promise<number[]> => {
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

  type MatchShowGroupProps = {
    files: readonly MatchFile[]
    pass: MatchPass
  }

  /**
   * The files of one show folder (or one file at a root): the show is found
   * once, then each file is placed in its season and episode.
   */
  const matchShowGroup = async ({ files, pass }: MatchShowGroupProps): Promise<void> => {
    const episodes = withoutExtras({ files, deps })
    const [first] = episodes
    if (!first) return
    const ids = episodes.map((file) => file.id)
    const fallbackShow = basename(rootOf(first))
    const showDir = showDirOf(first)
    const assets = showAssets(await pass.folders.names(showDir))
    const parsed = readShowFile(first)
    const place = showPlace(first)
    const resolved = await pass.resolve({
      type: ITEM_TYPES.show,
      fix: deps.files.fixMatchAt({ libraryId: first.libraryId, place }),
      ids: parsed.ids,
      nfoPath: assets.nfo == null ? null : join(showDir, assets.nfo),
      titles: showSearchTitles(parsed),
      decided: deps.decisions.highPickAt({ libraryId: first.libraryId, place }),
    })
    if (resolved.kind === RESOLVED_KINDS.unmatched) {
      deps.files.settle({ ids, itemIds: [], match: MATCH_STATES.unmatched })
      return
    }
    const show: ShowContext = {
      showId: resolved.itemId,
      showTmdbId: resolved.tmdbId,
      fallbackShow,
      match: resolved.match,
    }
    const touched = await episodes
      .reduce<Promise<number[]>>(
        (previous, file) =>
          previous.then(async (items) => [...items, ...(await placeEpisode({ file, show, pass }))]),
        Promise.resolve([]),
      )
      .catch((error: unknown) => {
        // A folder placed in part, say when TMDB went away fetching a season,
        // would sit under two shows; it waits to be matched whole instead.
        deps.files.setMatch({ ids, match: MATCH_STATES.pending })
        throw error
      })
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
