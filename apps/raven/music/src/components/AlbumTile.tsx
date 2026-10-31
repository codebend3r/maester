import { type AlbumSummary, artistNames } from '@raven/core'
import { Icon } from '@raven/native'
import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { ALBUM_TILE_COPY } from '@/components/copy'
import type { Cover } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** Whether a cover is drawn, or a disc in its place. */
const COVER_STATES = { shown: 'shown', missing: 'missing' } as const

type CoverState = (typeof COVER_STATES)[keyof typeof COVER_STATES]

type AlbumArtProps = { cover: Cover | null; size: number }

type CoverImageProps = AlbumArtProps

function CoverImage({ cover, size }: CoverImageProps) {
  return (
    cover !== null && (
      <Image
        accessibilityIgnoresInvertColors
        source={cover}
        style={{ width: size, height: size }}
      />
    )
  )
}

type CoverDiscProps = AlbumArtProps

function CoverDisc({ size }: CoverDiscProps) {
  return <Icon colour={PALETTE.muted} name={WREN_ICONS.cover} size={size / 3} />
}

const COVER_FACES = {
  [COVER_STATES.shown]: CoverImage,
  [COVER_STATES.missing]: CoverDisc,
} as const satisfies Record<CoverState, ComponentType<AlbumArtProps>>

/** An album's cover, square at `size`, or a disc drawn in its place while it has none. */
export function AlbumArt({ cover, size }: AlbumArtProps) {
  const Face = COVER_FACES[cover === null ? COVER_STATES.missing : COVER_STATES.shown]
  return (
    <View style={[styles.art, { width: size, height: size }]}>
      <Face cover={cover} size={size} />
    </View>
  )
}

type AlbumTileProps = { album: AlbumSummary; cover: Cover | null; width: number }

/** An album as a tile: its cover, its title and its artists, and a press to open its page. */
export function AlbumTile({ album, cover, width }: AlbumTileProps) {
  const router = useRouter()
  const artists = artistNames(album)
  return (
    <Pressable
      accessibilityLabel={ALBUM_TILE_COPY.label({ title: album.title, artists })}
      accessibilityRole="button"
      onPress={() => router.push(pageHref({ page: WREN_PAGES.album, id: album.id }))}
      style={({ pressed }) => [styles.tile, { width }, pressed && styles.pressed]}
    >
      <AlbumArt cover={cover} size={width} />
      <View>
        <Text numberOfLines={1} style={styles.title}>
          {album.title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {artists}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: { gap: SIZES.space1 },
  art: {
    alignItems: 'center',
    backgroundColor: PALETTE.raised,
    borderRadius: SIZES.radius,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: { color: PALETTE.text, fontSize: SIZES.textSm, fontWeight: 'bold' },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  pressed: { opacity: OPACITIES.pressed },
})
