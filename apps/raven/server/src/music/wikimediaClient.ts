import { Inject, Injectable } from '@nestjs/common'
import { isRecord, isString } from '@raven/core'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import { MusicBrainzClient } from '@/music/musicBrainzClient'
import { listAt, recordAt, serviceJson, textAt } from '@/music/serviceJson'
import {
  WIKIDATA_PROPERTIES,
  WIKI_LANGUAGE,
  type WikidataEntity,
  claimStringsOf,
  claimsOf,
  labelsOf,
} from '@/music/wikidata'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData'
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/Special:Redirect/file'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** The width of the artist's page photo, and of an option an owner may pick instead. */
const PHOTO_WIDTH = 500
const BACKGROUND_WIDTH = 1600

/** How many photos an artist's background options hold from Commons. */
const BACKGROUND_PHOTOS_MAX = 24

/** How many files one Commons category query lists. */
const CATEGORY_FILES_MAX = 50

/** What Commons puts before the name of each file a category lists. */
const COMMONS_FILE_PREFIX = 'File:'

/** The Commons files a background may be: pictures a browser draws, never a scan, a video or a sound. */
const BACKGROUND_FILE = /\.(jpe?g|png)$/i

/** A title as a wiki addresses its page: spaces written as underscores, then escaped. */
const pageNameOf = (title: string): string => encodeURIComponent(title.replaceAll(' ', '_'))

type CommonsAddressProps = { file: string; width: number }

/** Where Commons serves `file` at `width`. */
const commonsAddressOf = ({ file, width }: CommonsAddressProps): string =>
  `${COMMONS_FILE}/${pageNameOf(file)}?width=${width}`

/** The file names a Commons category query lists, `File:` stripped, in the order Commons gives them. */
const categoryFilesOf = (value: unknown): string[] => {
  if (!isRecord(value)) return []
  return listAt({ record: recordAt({ record: value, key: 'query' }), key: 'categorymembers' })
    .filter(isRecord)
    .flatMap((member) => {
      const title = member.title
      return isString(title) && title.startsWith(COMMONS_FILE_PREFIX)
        ? [title.slice(COMMONS_FILE_PREFIX.length)]
        : []
    })
}

/** The opening of an article in a Wikipedia summary answer. */
export const extractOf = (value: unknown): string | null =>
  textAt(isRecord(value) ? value.extract : null)?.trim() ?? null

/** The English names of the ids a `names` call asked for, any of them, in their order, each name once. */
type WikidataNames = (ids: string[]) => string[]

/**
 * Wikimedia's services, reached through the Wikidata entity MusicBrainz links an artist to:
 * the entity itself, the Commons pictures it files, the names of what it points at, and the
 * opening of its Wikipedia article. MusicBrainz being away rejects; Wikimedia being away gives
 * nothing, never an error.
 */
@Injectable()
export class WikimediaClient {
  constructor(
    @Inject(MusicBrainzClient) private readonly musicBrainz: MusicBrainzClient,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  /** A Wikimedia answer, or null when it is away. */
  private async json(url: string): Promise<unknown> {
    return serviceJson({ fetch: this.fetch, url }).catch(() => null)
  }

  /** The artist's Wikidata entity through MusicBrainz's relation to it; null when either has none. */
  async entity(mbid: string): Promise<WikidataEntity | null> {
    const id = await this.musicBrainz.wikidataId(mbid)
    if (id === null) return null
    const value = await this.json(`${WIKIDATA_ENTITY}/${id}.json`)
    return value === null ? null : { value, id }
  }

  /** The artist's Wikimedia Commons photo, when MusicBrainz and Wikidata have one. */
  async artistPhoto(mbid: string): Promise<string | null> {
    const entity = await this.entity(mbid)
    if (entity === null) return null
    const [file] = claimStringsOf({ claims: claimsOf(entity), property: WIKIDATA_PROPERTIES.image })
    return file === undefined ? null : commonsAddressOf({ file, width: PHOTO_WIDTH })
  }

  /**
   * The pictures Commons holds of the artist, wide enough for a page's head: the Wikidata photos
   * first, then the pictures in the artist's Commons category, at most `BACKGROUND_PHOTOS_MAX`.
   * Commons being away leaves the list short, never fails it.
   */
  async artistBackgroundPhotos(mbid: string): Promise<string[]> {
    const entity = await this.entity(mbid)
    if (entity === null) return []
    const claims = claimsOf(entity)
    const [category] = claimStringsOf({ claims, property: WIKIDATA_PROPERTIES.commonsCategory })
    const inCategory = category === undefined ? [] : await this.categoryFiles(category)
    const files = [
      ...claimStringsOf({ claims, property: WIKIDATA_PROPERTIES.image }),
      ...inCategory,
    ]
    return [...new Set(files)]
      .filter((file) => BACKGROUND_FILE.test(file))
      .slice(0, BACKGROUND_PHOTOS_MAX)
      .map((file) => commonsAddressOf({ file, width: BACKGROUND_WIDTH }))
  }

  /** The files in a Commons category, or none when Commons does not answer. */
  private async categoryFiles(category: string): Promise<string[]> {
    const query = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmtype: 'file',
      cmlimit: String(CATEGORY_FILES_MAX),
      format: 'json',
    })
    return categoryFilesOf(await this.json(`${COMMONS_API}?${query.toString()}`))
  }

  /** The opening of the Wikipedia article `title` names, or null when it has none or is away. */
  async intro(title: string): Promise<string | null> {
    return extractOf(await this.json(`${WIKIPEDIA_SUMMARY}/${pageNameOf(title)}`))
  }

  /** The English names of `ids`, asked of Wikidata in one call; none when there are none to name. */
  async names(ids: string[]): Promise<WikidataNames> {
    const query = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'labels',
      languages: WIKI_LANGUAGE,
      format: 'json',
    })
    const value = ids.length === 0 ? null : await this.json(`${WIKIDATA_API}?${query.toString()}`)
    return (wanted) => labelsOf({ value, ids: wanted })
  }
}
