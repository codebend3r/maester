import type { Artist } from '@raven/core'
import { countsLineOf } from '@raven/wren'
import { type ArtistPhotoOf } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { router } from 'expo-router'

import { SIZE } from '@/theme/tvTokens'
import { Tile } from '@/ui/Tile'
import { shownWords } from '@/ui/words'

type ArtistTileOfProps = {
  artist: Artist
  photoOf: ArtistPhotoOf
  width?: number
  /** The line under the name: its albums and tracks unless the place says less (Search's none). */
  line?: string | null
  /** What a press does: opens the artist's page, unless the place does more (Search remembers it). */
  onOpen?: (artist: Artist) => void
}

const openArtist = (artist: Artist): void => {
  router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))
}

/** An artist as a round tile, the phone's card: its photo, its name and a line, read by its name. */
export function ArtistTileOf({
  artist,
  photoOf,
  width = SIZE.artistPhoto,
  line,
  onOpen = openArtist,
}: ArtistTileOfProps) {
  const counts = shownWords(countsLineOf({ albums: artist.albumCount, tracks: artist.trackCount }))
  return (
    <Tile
      cover={photoOf(artist)}
      isRound
      label={artist.name}
      line={line === undefined ? counts : line}
      onPress={() => onOpen(artist)}
      title={artist.name}
      width={width}
    />
  )
}
