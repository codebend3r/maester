import { type ArtistAbout, formatReleaseDate } from '@raven/core'

import { ARTIST_COPY } from '@/copy/screens'

/** One fact under an artist's bio: what it is and what it says. */
type AboutFact = { label: string; value: string }

type MaybeFact = { label: string; value: string | null }

const isKnown = (fact: MaybeFact): fact is AboutFact => fact.value !== null

/** A list as one fact's value, or null when it holds nothing. */
const listValueOf = (names: readonly string[]): string | null =>
  names.length === 0 ? null : ARTIST_COPY.listLine(names)

/** The facts under an artist's bio, in the order they read, leaving out what is not known. */
export const aboutFactsOf = ({
  birthName,
  born,
  birthplace,
  nationality,
  awards,
}: ArtistAbout): AboutFact[] => {
  const facts: readonly MaybeFact[] = [
    { label: ARTIST_COPY.birthName, value: birthName },
    { label: ARTIST_COPY.born, value: born === null ? null : formatReleaseDate(born) },
    { label: ARTIST_COPY.birthplace, value: birthplace },
    { label: ARTIST_COPY.nationality, value: listValueOf(nationality) },
    { label: ARTIST_COPY.awards, value: listValueOf(awards) },
  ]
  return facts.filter(isKnown)
}

/** Whether there is anything to say about the artist at all. */
export const hasAbout = (about: ArtistAbout): boolean =>
  about.bio !== null || aboutFactsOf(about).length > 0
