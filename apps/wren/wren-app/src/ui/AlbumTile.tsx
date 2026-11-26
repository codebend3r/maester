import { type AlbumSummary, artistNames } from '@raven/core'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { KIT_COPY } from '@raven/wren'
import { type Cover, type CoverOf } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { pressedStyleOf } from '@/ui/press'

/** A title wraps to this many lines; the rest is cut with an ellipsis. */
const TITLE_LINES = 4

/** The line under the title wraps to this many. */
const SUBTITLE_LINES = 2

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  tile: { gap: SPACE.s2 },
  title: { ...TYPE.tileAlbum, color: colors.text },
  subtitle: { ...TYPE.tileArtist, color: colors.text },
  detail: { ...TYPE.meta, color: colors.text2 },
}))

type AlbumTileProps = {
  title: string
  /** The line under the title: the artists, or a playlist's count. */
  subtitle: string
  /** A third line, where the place adds one: the date Home's albums are ordered by. */
  detail?: string
  cover: Cover | null
  width: number
  /** What the tile is called aloud: "OK Computer, Radiohead". */
  label: string
  onPress: () => void
}

/** An album or a playlist as a tile: its square art, its title (up to four lines) and the line under it (up to two). */
export function AlbumTile({
  title,
  subtitle,
  detail,
  cover,
  width,
  label,
  onPress,
}: AlbumTileProps) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={pressedStyleOf({ style: [styles.tile, { width }] })}
    >
      <AlbumArt cover={cover} size={width} />
      <View>
        <Text numberOfLines={TITLE_LINES} style={styles.title}>
          {title}
        </Text>
        <Text numberOfLines={SUBTITLE_LINES} style={styles.subtitle}>
          {subtitle}
        </Text>
        {detail !== undefined && (
          <Text numberOfLines={1} style={styles.detail}>
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

type AlbumTileOfProps = {
  album: AlbumSummary
  coverOf: CoverOf
  width: number
  /** The line under the title; its artists unless the place says otherwise (an artist's years). */
  subtitle?: string
  /** A third line under the title, read out after the artists. */
  detail?: string
  /** What a press does; opening the album's page unless the place does more (Search remembers it). */
  onPress?: (album: AlbumSummary) => void
}

/** An album as a tile, read out by its title, artists and any third line, that opens its page. */
export function AlbumTileOf({
  album,
  coverOf,
  width,
  subtitle,
  detail,
  onPress,
}: AlbumTileOfProps) {
  const router = useRouter()
  const artists = artistNames(album)
  const label = KIT_COPY.labelled({ label: album.title, value: artists })
  const open = () => router.push(pageHref({ page: WREN_PAGES.album, id: album.id }))
  return (
    <AlbumTile
      cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
      detail={detail}
      label={detail === undefined ? label : KIT_COPY.labelled({ label, value: detail })}
      onPress={() => (onPress === undefined ? open() : onPress(album))}
      subtitle={subtitle ?? artists}
      title={album.title}
      width={width}
    />
  )
}
