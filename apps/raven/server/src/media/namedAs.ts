import {
  ITEM_TYPES,
  type LibraryKind,
  MATCH_STATES,
  type MatchState,
  isExtra,
  matchTypeFor,
  parseEpisodeName,
  parseMovieName,
  titleFromFileName,
} from '@raven/core'

type NamedAsProps = {
  kind: LibraryKind
  fileName: string
  folder: string
}

/** What a name says a file is, by its library's type. Extras and libraries that are not matched keep the tidied name. */
export const namedAs = ({
  kind,
  fileName,
  folder,
}: NamedAsProps): {
  title: string
  year: number | null
  edition: string | null
  match: MatchState
} => {
  const type = matchTypeFor(kind)
  if (type == null || isExtra({ fileName, folder })) {
    return {
      title: titleFromFileName(fileName),
      year: null,
      edition: null,
      match: MATCH_STATES.off,
    }
  }
  switch (type) {
    case ITEM_TYPES.movie: {
      const parsed = parseMovieName({ fileName, folder })
      return {
        title: parsed.title,
        year: parsed.year,
        edition: parsed.edition,
        match: MATCH_STATES.pending,
      }
    }
    case ITEM_TYPES.show: {
      // An episode keeps its tidied file name until it is matched, since the
      // name alone rarely says which show it is; the year is the show's.
      const parsed = parseEpisodeName({ fileName, folder })
      return {
        title: titleFromFileName(fileName),
        year: parsed.year,
        edition: null,
        match: MATCH_STATES.pending,
      }
    }
    default: {
      const unknown: never = type
      return unknown
    }
  }
}
