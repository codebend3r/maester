import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  LYRICS_KINDS,
  LYRICS_SOURCES,
  type Lyrics,
  NO_LYRICS,
  type Track,
  lyricsOfText,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { errorMessage } from '@/errorMessage'
import { MediaIndex } from '@/media/mediaIndex'
import { AudioReader } from '@/music/audioReader'
import { LrclibClient, LrclibError, type LrclibLyrics } from '@/music/lrclibClient'
import { MusicRepository } from '@/music/musicRepository'

/** The extension of the synced lyrics file kept beside a track, with the track's own name. */
const SIDECAR_EXTENSION = '.lrc'

/** `song.flac`'s sidecar, `song.lrc`. */
const sidecarOf = (path: string): string =>
  `${path.slice(0, path.length - extname(path).length)}${SIDECAR_EXTENSION}`

type FromLrclibProps = LrclibLyrics

/** The lyrics LRCLIB keeps, as a client reads them: its LRC file first, else its plain text. */
const fromLrclib = ({ synced, plain }: FromLrclibProps): Lyrics => {
  const timed =
    synced === null ? NO_LYRICS : lyricsOfText({ text: synced, source: LYRICS_SOURCES.lrclib })
  if (timed.kind !== LYRICS_KINDS.none) return timed
  return plain === null ? NO_LYRICS : lyricsOfText({ text: plain, source: LYRICS_SOURCES.lrclib })
}

type TrackLyricsSharedProps = { track: Track }

type TrackLyricsAskLrclibProps = { track: Track }

/**
 * A track's lyrics, looked for in order: the file's own lyrics tag, an
 * `.lrc` file of the same name beside it, then LRCLIB. The tag and the
 * sidecar are read each time they are asked for, so a fix to either shows
 * at once and a scan keeps no text; LRCLIB's answer, a miss included, is
 * kept in `track_lyrics`, so it is asked once per track. LRCLIB away is not
 * an answer and is asked again next time.
 */
@Injectable()
export class TrackLyrics {
  private readonly logger = new Logger(TrackLyrics.name)
  /** LRCLIB calls in flight, by track, so two asks for one track make one call. */
  private readonly asking = new Map<number, Promise<Lyrics>>()

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(AudioReader) private readonly reader: AudioReader,
    @Inject(LrclibClient) private readonly lrclib: LrclibClient,
  ) {}

  private get db() {
    return this.database.db
  }

  /** The track's lyrics, or null when `mediaId` is no track. */
  async of(mediaId: number): Promise<Lyrics | null> {
    const file = this.index.fileOf(mediaId)
    const track = this.music.tracks([mediaId]).get(mediaId)
    if (file === null || track === undefined) return null
    const tagged = await this.reader.lyrics(file.path).catch(() => NO_LYRICS)
    if (tagged.kind !== LYRICS_KINDS.none) return tagged
    const sidecar = await readFile(sidecarOf(file.path), 'utf8').then(
      (text) => lyricsOfText({ text, source: LYRICS_SOURCES.sidecar }),
      () => NO_LYRICS,
    )
    if (sidecar.kind !== LYRICS_KINDS.none) return sidecar
    return this.fromCache(mediaId) ?? this.shared({ track })
  }

  private fromCache(mediaId: number): Lyrics | null {
    const row = this.db
      .prepare<[number], LrclibLyrics>('SELECT synced, plain FROM track_lyrics WHERE media_id = ?')
      .get(mediaId)
    return row === undefined ? null : fromLrclib(row)
  }

  private shared({ track }: TrackLyricsSharedProps): Promise<Lyrics> {
    const known = this.asking.get(track.id)
    if (known) return known
    const asked = this.askLrclib({ track }).finally(() => this.asking.delete(track.id))
    this.asking.set(track.id, asked)
    return asked
  }

  /** LRCLIB's lyrics for the track, kept for next time; none, uncached, while LRCLIB is away. */
  private async askLrclib({ track }: TrackLyricsAskLrclibProps): Promise<Lyrics> {
    const [artist] = track.artists
    if (artist === undefined || track.duration === null) return NO_LYRICS
    try {
      const found = await this.lrclib.lyrics({
        artist: artist.name,
        track: track.title,
        album: track.album.title,
        duration: track.duration,
      })
      const kept: LrclibLyrics = found ?? { synced: null, plain: null }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO track_lyrics (media_id, synced, plain, fetched_at)
           VALUES (@mediaId, @synced, @plain, @at)`,
        )
        .run({ mediaId: track.id, ...kept, at: new Date().toISOString() })
      return fromLrclib(kept)
    } catch (error) {
      if (!(error instanceof LrclibError)) throw error
      this.logger.warn(`No lyrics from LRCLIB for now: ${errorMessage(error)}`)
      return NO_LYRICS
    }
  }
}
