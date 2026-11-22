import { isRecord, isString } from '@raven/core'
import { listAt, recordAt, textAt } from '@/music/serviceJson'

/** The Wikidata properties raven reads of an artist. */
export const WIKIDATA_PROPERTIES = {
  image: 'P18',
  commonsCategory: 'P373',
  birthName: 'P1477',
  born: 'P569',
  birthplace: 'P19',
  nationality: 'P27',
  awards: 'P166',
} as const

/** The language raven reads Wikidata's names and Wikipedia's articles in. */
export const WIKI_LANGUAGE = 'en'

/** The wiki whose article an entity links for its bio. */
const WIKI = 'enwiki'

/** A Wikidata entity's answer and the id it answers for. */
export type WikidataEntity = { value: unknown; id: string }

/** The entity a Wikidata answer holds, or an empty record. */
const entityOf = ({ value, id }: WikidataEntity): Record<string, unknown> =>
  isRecord(value) ? recordAt({ record: recordAt({ record: value, key: 'entities' }), key: id }) : {}

/** The claims of the entity a Wikidata answer holds, by property. */
export const claimsOf = (entity: WikidataEntity): Record<string, unknown> =>
  recordAt({ record: entityOf(entity), key: 'claims' })

type ClaimsByPropertyProps = { claims: Record<string, unknown>; property: string }

/** The values a Wikidata property holds, in the order Wikidata lists them. */
export const claimDataOf = ({ claims, property }: ClaimsByPropertyProps): unknown[] =>
  listAt({ record: claims, key: property })
    .filter(isRecord)
    .map(
      (claim) =>
        recordAt({ record: recordAt({ record: claim, key: 'mainsnak' }), key: 'datavalue' }).value,
    )

/** The strings a Wikidata property holds, in the order Wikidata lists them. */
export const claimStringsOf = (props: ClaimsByPropertyProps): string[] =>
  claimDataOf(props).flatMap((data) => textAt(data) ?? [])

/** The Wikidata ids a property points at (awards, places, countries), each once. */
export const entityIdsOf = ({ claims, property }: ClaimsByPropertyProps): string[] => [
  ...new Set(
    claimDataOf({ claims, property }).flatMap((value) => {
      const id = isRecord(value) ? value.id : null
      return isString(id) ? [id] : []
    }),
  ),
]

/** The title of the entity's English Wikipedia article, when it has one. */
export const articleOf = (entity: WikidataEntity): string | null => {
  const title = recordAt({
    record: recordAt({ record: entityOf(entity), key: 'sitelinks' }),
    key: WIKI,
  }).title
  return isString(title) ? title : null
}

type LabelsOfProps = { value: unknown; ids: string[] }

/** The English names of `ids` in a `wbgetentities` answer, in their order, each name once. */
export const labelsOf = ({ value, ids }: LabelsOfProps): string[] => {
  const names = ids.flatMap((id) => {
    const labels = recordAt({ record: entityOf({ value, id }), key: 'labels' })
    const name = recordAt({ record: labels, key: WIKI_LANGUAGE }).value
    return isString(name) ? [name] : []
  })
  return [...new Set(names)]
}
