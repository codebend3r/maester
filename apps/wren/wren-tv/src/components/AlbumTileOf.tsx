import { type AlbumSummary, artistNames } from '@raven/core'
import { router } from 'expo-router'

import { type CoverOf } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { SIZE } from '@/theme/tvTokens'
import { Tile } from '@/ui/Tile'

type AlbumTileOfProps = {
  album: AlbumSummary
  coverOf: CoverOf
  width?: number
  /** The line under the title: its artists unless the place says otherwise (an artist's years). */
  line?: string | null
  /** A third line, read out after the second: Home's date. */
  detail?: string | null
  /** What a press does: opens the album's page, unless the place does more (Search remembers it). */
  onOpen?: (album: AlbumSummary) => void
}

const openAlbum = (album: AlbumSummary): void => {
  router.push(pageHref({ page: WREN_PAGES.album, id: album.id }))
}

/** An album as a tile, read out by its title, its artists and any third line, that opens its page. */
export function AlbumTileOf({
  album,
  coverOf,
  width = SIZE.tile,
  line,
  detail = null,
  onOpen = openAlbum,
}: AlbumTileOfProps) {
  return (
    <Tile
      cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
      detail={detail}
      line={line === undefined ? artistNames(album) : line}
      onPress={() => onOpen(album)}
      title={album.title}
      width={width}
    />
  )
}
