import {
  type LibraryKind,
  type MatchState,
  isExtra,
  isMatchedKind,
  matchedItemType,
  parseEpisodeName,
  parseMovieName,
  titleFromFileName,
} from '@raven/core'

/** What a name says a file is, by its library's type. Extras and libraries that are not matched keep the tidied name. */
export const namedAs = ({
  kind,
  fileName,
  folder,
}: {
  kind: LibraryKind
  fileName: string
  folder: string
}): { title: string; year: number | null; edition: string | null; match: MatchState } => {
  if (!isMatchedKind(kind) || isExtra({ fileName, folder })) {
    return { title: titleFromFileName(fileName), year: null, edition: null, match: 'off' }
  }
  if (matchedItemType(kind) === 'movie') {
    const parsed = parseMovieName({ fileName, folder })
    return { title: parsed.title, year: parsed.year, edition: parsed.edition, match: 'pending' }
  }
  // An episode keeps its tidied file name until it is matched, since the
  // name alone rarely says which show it is; the year is the show's.
  const parsed = parseEpisodeName({ fileName, folder })
  return { title: titleFromFileName(fileName), year: parsed.year, edition: null, match: 'pending' }
}
