import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  ARTIST_BACKGROUND_KINDS,
  type ArtistBackgroundKind,
  type ArtistBackgroundOption,
  type ArtistBackgrounds,
  POSTER_OWN_WIDTH,
} from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { ImageCache } from '@/metadata/imageCache'
import { AlbumCovers } from '@/music/albumCovers'
import { ArtistArtClient } from '@/music/artistArtClient'
import { type ArtistSources, MusicCoverStore } from '@/music/musicCoverStore'
import { Remembered } from '@/music/remembered'
import { WikimediaClient } from '@/music/wikimediaClient'

/** How long the options listed for an artist stay addressable by their keys. */
const REGISTRY_TTL_MS = 30 * 60 * 1000

/** What an option's source starts with when it is the cover of one of the artist's albums. */
const COVER_PREFIX = 'album:'

/** How much of the source's hash a key keeps. */
const KEY_LENGTH = 16

/** What choosing an option came to. */
export const BACKGROUND_CHOICES = {
  chosen: 'chosen',
  noArtist: 'noArtist',
  noOption: 'noOption',
} as const

type BackgroundChoice = (typeof BACKGROUND_CHOICES)[keyof typeof BACKGROUND_CHOICES]

type SourcedOption = ArtistBackgroundOption & { source: string }

type ChooseProps = { artistId: number; key: string | null }
type SourceOfProps = { artistId: number; key: string }
type PathOfProps = { artistId: number; source: string }
type BuildProps = { artistId: number } & ArtistSources

/** The key of an option: a short hash of its source, so the same picture is always the same option. */
const keyOf = (source: string): string =>
  createHash('sha256').update(source).digest('hex').slice(0, KEY_LENGTH)

const kindOf = (source: string): ArtistBackgroundKind =>
  source.startsWith(COVER_PREFIX) ? ARTIST_BACKGROUND_KINDS.cover : ARTIST_BACKGROUND_KINDS.photo

const optionOf = (source: string): SourcedOption => ({
  key: keyOf(source),
  kind: kindOf(source),
  source,
})

type SourceInProps = { options: SourcedOption[]; key: string }

/** The source of the option `key` names among `options`; null for none. */
const sourceIn = ({ options, key }: SourceInProps): string | null =>
  options.find((option) => option.key === key)?.source ?? null

/** The album id a cover source names; null for a source that is not one, or names no album. */
const coverAlbumOf = (source: string): number | null => {
  if (!source.startsWith(COVER_PREFIX)) return null
  const id = Number(source.slice(COVER_PREFIX.length))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * What an owner may set as an artist's page background: the backdrops fanart.tv and TheAudioDB
 * keep for them, the pictures Commons holds of them, and the covers of their albums. The options
 * are listed on demand and remembered for a while, so a key in a picture's address or a choice
 * names one the owner was shown.
 */
@Injectable()
export class ArtistBackgroundOptions {
  private readonly logger = new Logger(ArtistBackgroundOptions.name)
  private readonly registry = new Remembered<number, SourcedOption[]>(REGISTRY_TTL_MS)

  constructor(
    @Inject(MusicCoverStore) private readonly store: MusicCoverStore,
    @Inject(WikimediaClient) private readonly wikimedia: WikimediaClient,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(AlbumCovers) private readonly covers: AlbumCovers,
    @Inject(ArtistArtClient) private readonly art: ArtistArtClient,
  ) {}

  private async commons(mbid: string): Promise<string[]> {
    return this.wikimedia.artistBackgroundPhotos(mbid).catch((error: unknown) => {
      this.logger.warn(`Could not list the photos of artist ${mbid}: ${errorMessage(error)}`)
      return []
    })
  }

  /**
   * The artist's photos, the ones made for a backdrop first: fanart.tv's and TheAudioDB's, which
   * are curated and wide, then whatever Commons holds of them, which is anything filed under
   * their name.
   */
  private async photos(mbid: string | null): Promise<string[]> {
    if (mbid === null) return []
    const [made, commons] = await Promise.all([this.art.backgrounds(mbid), this.commons(mbid)])
    return [...made, ...commons]
  }

  /** Every option for the artist, remembered; the one worn leads when no list holds it. */
  private async build({ artistId, mbid, background }: BuildProps): Promise<SourcedOption[]> {
    const photos = await this.photos(mbid)
    const covers = this.store.artistCoverAlbums(artistId).map((id) => `${COVER_PREFIX}${id}`)
    const listed = [...new Set([...photos, ...covers])]
    const sources =
      background === null || listed.includes(background) ? listed : [background, ...listed]
    const options = sources.map(optionOf)
    this.registry.set({ key: artistId, value: options })
    return options
  }

  /** The artist's options and the key of the one worn; null for no such artist. */
  async list(artistId: number): Promise<ArtistBackgrounds | null> {
    const artist = this.store.artistSources(artistId)
    if (artist === null) return null
    const options = await this.build({ artistId, ...artist })
    return {
      options: options.map(({ key, kind }) => ({ key, kind })),
      chosen: artist.background === null ? null : keyOf(artist.background),
    }
  }

  /**
   * The source an option's key names: one of the options listed lately, or the one worn, which a
   * picture's address may name after the list is forgotten. Null for any other key.
   */
  sourceOf({ artistId, key }: SourceOfProps): string | null {
    const worn = this.store.artistSources(artistId)?.background ?? null
    if (worn !== null && keyOf(worn) === key) return worn
    return sourceIn({ options: this.registry.get(artistId) ?? [], key })
  }

  /** Wears an option by its key, or the default photo again for null. */
  async choose({ artistId, key }: ChooseProps): Promise<BackgroundChoice> {
    const artist = this.store.artistSources(artistId)
    if (artist === null) return BACKGROUND_CHOICES.noArtist
    if (key === null) {
      this.store.setArtistBackground({ id: artistId, background: null })
      return BACKGROUND_CHOICES.chosen
    }
    const options = this.registry.get(artistId) ?? (await this.build({ artistId, ...artist }))
    const source = sourceIn({ options, key })
    if (source === null) return BACKGROUND_CHOICES.noOption
    this.store.setArtistBackground({ id: artistId, background: source })
    return BACKGROUND_CHOICES.chosen
  }

  /** The cached file of the picture a source names; null when it cannot be made. */
  async pathOf({ artistId, source }: PathOfProps): Promise<string | null> {
    const albumId = coverAlbumOf(source)
    if (albumId === null) return this.images.artist({ artistId, source })
    const version = this.store.albumCoverVersion(albumId)
    if (version === null) return null
    return this.covers.pathOf({ id: albumId, version, width: POSTER_OWN_WIDTH })
  }
}
