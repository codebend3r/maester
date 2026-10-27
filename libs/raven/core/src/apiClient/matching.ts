import type { Transport } from '@/apiClient/transport'
import {
  isMatchCandidateList,
  isMediaItem,
  isServerHealth,
  MATCH_SUBJECT_KINDS,
  type MatchCandidate,
  type MatchChoice,
  type MatchItemType,
  type MatchSubject,
  type MediaItem,
  type MetadataHealth,
} from '@/contract'
import { toQueryString } from '@/query'

/** The query a search's subject adds: the file, or the show, it is scored against. */
const subjectQuery = (subject: MatchSubject | null): Record<string, string> => {
  if (subject == null) return {}
  switch (subject.kind) {
    case MATCH_SUBJECT_KINDS.media:
      return { mediaId: String(subject.id) }
    case MATCH_SUBJECT_KINDS.item:
      return { itemId: String(subject.id) }
    default: {
      const unreachable: never = subject
      return unreachable
    }
  }
}

type SearchMatchesProps = {
  type: MatchItemType
  query: string
  year?: number | null
  libraryId?: number | null
  /** The file or show the search is for, which its results are scored against. */
  subject?: MatchSubject | null
}

type SetMatchProps = {
  mediaId: number
  tmdbId: string | null
}

/** Fix match: TMDB's candidates for a file, the choice among them, and how matching is doing. */
export const matchingCalls = ({ send, expect }: Transport) => ({
  /**
   * TMDB's results for Fix match, best first by confidence, scored against
   * what `subject` has on disk; `libraryId`'s type comes first among equals.
   */
  searchMatches: ({
    type,
    query,
    year,
    libraryId,
    subject = null,
  }: SearchMatchesProps): Promise<MatchCandidate[]> =>
    expect({
      request: send({
        path: `/api/match/search?${toQueryString({
          type,
          query: query.trim(),
          ...(year == null ? {} : { year: String(year) }),
          ...(libraryId == null ? {} : { libraryId: String(libraryId) }),
          ...subjectQuery(subject),
        })}`,
      }),
      guard: isMatchCandidateList,
    }),

  /**
   * Points a file, and every file in its folder, at a TMDB id, and keeps
   * that through renames; `null` says it is not a movie at all.
   */
  setMatch: ({ mediaId, tmdbId }: SetMatchProps): Promise<MediaItem> =>
    expect({
      request: send({
        path: `/api/media/${mediaId}/match`,
        method: 'PUT',
        body: { tmdbId } satisfies MatchChoice,
      }),
      guard: isMediaItem,
    }),

  /** How matching is doing, and whether TMDB is configured at all. */
  getMetadataHealth: async (): Promise<MetadataHealth> =>
    (await expect({ request: send({ path: '/api/health' }), guard: isServerHealth })).metadata,
})
