import { Inject, Injectable, Logger } from '@nestjs/common'
import { type ArtistAbout as About, isRecord, isString } from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { Remembered } from '@/music/remembered'
import { textAt } from '@/music/serviceJson'
import {
  WIKIDATA_PROPERTIES,
  articleOf,
  claimDataOf,
  claimsOf,
  entityIdsOf,
} from '@/music/wikidata'
import { WikimediaClient } from '@/music/wikimediaClient'

/** How many awards an about lists, and how many Wikidata names in one call (its limit). */
const AWARDS_MAX = 8
const LABELS_PER_CALL = 50

/** How long an artist's about is remembered before Wikipedia and Wikidata are asked again. */
const ABOUT_TTL_MS = 24 * 60 * 60 * 1000

/** What an artist with no Wikidata entity, or none reachable, is known by. */
const UNKNOWN: About = {
  bio: null,
  birthName: null,
  born: null,
  birthplace: null,
  nationality: [],
  awards: [],
}

type ClaimsProps = { claims: Record<string, unknown> }

/** The name the artist was born with; the first Wikidata records. */
export const birthNameOf = ({ claims }: ClaimsProps): string | null => {
  const [name] = claimDataOf({ claims, property: WIKIDATA_PROPERTIES.birthName }).flatMap(
    (value) => textAt(isRecord(value) ? value.text : null)?.trim() ?? [],
  )
  return name ?? null
}

/** Wikidata's day precision; a coarser date names a month or a year, not a birthday. */
const DAY_PRECISION = 11

/** The day the artist was born, `1986-10-24`, when Wikidata knows it to the day. */
export const bornOf = ({ claims }: ClaimsProps): string | null => {
  const [day] = claimDataOf({ claims, property: WIKIDATA_PROPERTIES.born }).flatMap((value) => {
    if (!isRecord(value) || value.precision !== DAY_PRECISION || !isString(value.time)) return []
    return /^\+(\d{4}-\d{2}-\d{2})T/.exec(value.time)?.[1] ?? []
  })
  return day ?? null
}

type ArtistAboutOfProps = { artistId: number; mbid: string | null }

/**
 * Who an artist is, for the head of their page: the opening of their Wikipedia article, and
 * their birth name, birthday, birthplace, nationality and awards from Wikidata, both found
 * through MusicBrainz's link to the entity. Remembered for a day; anything away or missing
 * leaves its part empty, never fails it.
 */
@Injectable()
export class ArtistAbout {
  private readonly logger = new Logger(ArtistAbout.name)
  private readonly remembered = new Remembered<number, About>(ABOUT_TTL_MS)

  constructor(@Inject(WikimediaClient) private readonly wikimedia: WikimediaClient) {}

  private async read(mbid: string | null): Promise<About> {
    if (mbid === null) return UNKNOWN
    const entity = await this.wikimedia.entity(mbid).catch((error: unknown) => {
      this.logger.warn(`Could not find artist ${mbid} on Wikidata: ${errorMessage(error)}`)
      return null
    })
    if (entity === null) return UNKNOWN
    const claims = claimsOf(entity)
    const birthplaceIds = entityIdsOf({ claims, property: WIKIDATA_PROPERTIES.birthplace }).slice(
      0,
      1,
    )
    const nationalityIds = entityIdsOf({ claims, property: WIKIDATA_PROPERTIES.nationality })
    const awardIds = entityIdsOf({ claims, property: WIKIDATA_PROPERTIES.awards })
    // One call names them all, so the awards get what room is left under Wikidata's limit.
    const named = [...birthplaceIds, ...nationalityIds]
    const ids = [...named, ...awardIds.slice(0, LABELS_PER_CALL - named.length)]
    const title = articleOf(entity)
    const [bio, namesOf] = await Promise.all([
      title === null ? null : this.wikimedia.intro(title),
      this.wikimedia.names(ids),
    ])
    const [birthplace = null] = namesOf(birthplaceIds)
    return {
      bio,
      birthName: birthNameOf({ claims }),
      born: bornOf({ claims }),
      birthplace,
      nationality: namesOf(nationalityIds),
      awards: namesOf(awardIds).slice(0, AWARDS_MAX),
    }
  }

  /** The about of the artist `mbid` names, remembered under their id. */
  async of({ artistId, mbid }: ArtistAboutOfProps): Promise<About> {
    const kept = this.remembered.get(artistId)
    if (kept !== null) return kept
    const about = await this.read(mbid)
    this.remembered.set({ key: artistId, value: about })
    return about
  }
}
