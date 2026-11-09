import { plural } from '@raven/core'
import type { MatchTally } from '@/music/albumMatching'
import type { Release } from '@/music/musicBrainzClient'
import type { StrayFold } from '@/music/strayAlbums'

type MatchedProps = { album: string; release: Release; isByClaude: boolean }

type FinishedProps = MatchTally & { folded: number }

/** The year a release came out, in brackets, or nothing when MusicBrainz gives none. */
const yearOf = (release: Release): string => (release.year === null ? '' : ` (${release.year})`)

/** The albums a pass left pending, when it could not search every one. */
const leftOf = ({ searched, total }: MatchTally): string =>
  searched === total
    ? ''
    : ` ${plural({ n: total - searched, one: 'album', many: 'albums' })} could not be searched and wait for the next pass.`

/** The strays folded before the search, when there were any. */
const foldedOf = (folded: number): string =>
  folded === 0
    ? ''
    : ` Folded ${plural({ n: folded, one: 'stray album', many: 'stray albums' })} into the albums they belong with.`

/** What smart match tells the account that started it, as each step lands; each is a notification. */
export const SMART_MATCH_COPY = {
  folded: ({ from, into, tracks }: StrayFold) =>
    `Moved ${plural({ n: tracks, one: 'track', many: 'tracks' })} of "${from}" into "${into}", the album they belong with.`,
  matched: ({ album, release, isByClaude }: MatchedProps) =>
    `Matched "${album}" to ${release.artist}'s "${release.title}"${yearOf(release)}${isByClaude ? ', with Claude' : ''}.`,
  unmatched: (album: string) =>
    `No MusicBrainz release found for "${album}". Fix match can set it by hand.`,
  finished: ({ folded, ...tally }: FinishedProps) =>
    `Smart match is done: ${tally.matched} of ${plural({ n: tally.total, one: 'album', many: 'albums' })} matched.${leftOf(tally)}${foldedOf(folded)}`,
  failed: (reason: string) => `Smart match stopped: ${reason}`,
} as const
