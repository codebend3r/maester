import { LIBRARY_KINDS, type LibraryKind } from '@raven/core'
import type { DatabaseService } from '@/db/database'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaIndex } from '@/media/mediaIndex'
import type { AudioTags } from '@/music/audioReader'
import { MusicRepository } from '@/music/musicRepository'
import { pictureVersionsOf } from '@/test/repositories'

const NO_TAGS: AudioTags = {
  title: null,
  artists: [],
  album: null,
  albumArtists: [],
  trackNumber: null,
  disc: null,
  year: null,
  originalYear: null,
  genres: [],
  isCompilation: false,
  label: null,
  isrc: null,
  recordingMbid: null,
  releaseMbid: null,
  releaseGroupMbid: null,
  artistMbids: [],
  albumArtistMbids: [],
  releaseTypes: [],
  replayGain: { trackGain: null, trackPeak: null, albumGain: null, albumPeak: null },
  hasCover: false,
}

type AddLibraryProps = { name: string; isLocked?: boolean; kind?: LibraryKind }

type AddTrackProps = {
  libraryId: number
  title: string
  artist: string
  album: string
  artistMbid?: string
  genres?: string[]
  at?: Date
}

/**
 * Music libraries (or an audiobooks one, whose chapters a scan files as
 * tracks too) filled by hand over `database`, as a scan files them: each
 * track a file in the index with a probe, filed under its artist and album.
 */
export const musicLibrary = (database: DatabaseService) => {
  const music = new MusicRepository(database, pictureVersionsOf(database))
  const libraries = new LibrariesRepository(database)
  const addLibrary = ({
    name,
    isLocked = false,
    kind = LIBRARY_KINDS.music,
  }: AddLibraryProps): number =>
    libraries.create({ name, paths: [`/${name}`], settings: { kind, locked: isLocked } }).id
  const addTrack = ({
    libraryId,
    title,
    artist,
    album,
    artistMbid,
    genres = [],
    at,
  }: AddTrackProps): number => {
    const index = new MediaIndex(database)
    const path = `/${libraryId}/${artist}/${album}/${title}.flac`
    const id = index.insert({
      libraryId,
      kind: libraries.get(libraryId)?.settings.kind ?? LIBRARY_KINDS.music,
      file: { path, root: `/${libraryId}`, size: 1, mtimeMs: 1 },
      at,
    })
    index.saveProbe({
      id,
      probe: {
        duration: 200,
        width: null,
        height: null,
        videoCodec: null,
        videoBitDepth: null,
        hdr: false,
        audioCodec: 'flac',
        audioChannels: 2,
        bitrate: 900000,
      },
      tracks: { audio: [], subtitles: [], defaultAudio: null, frameRate: null },
      chapters: [],
    })
    const mbids = artistMbid === undefined ? [] : [artistMbid]
    music.record({
      mediaId: id,
      libraryId,
      path,
      tags: {
        ...NO_TAGS,
        title,
        artists: [artist],
        albumArtists: [artist],
        artistMbids: mbids,
        albumArtistMbids: mbids,
        album,
        genres,
      },
      format: { sampleRate: 44100, bitDepth: 16, isLossless: true },
      folderCover: null,
      at,
    })
    return id
  }
  return { music, addLibrary, addTrack }
}
