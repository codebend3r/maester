import { type AlbumSummary, artistNames } from '@raven/core'
import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { ALBUM_TILE_COPY } from '@/components/copy'
import type { Cover } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

/** Whether a cover is on its way over its letter, or there is none and the letter stands alone. */
const COVER_STATES = { shown: 'shown', missing: 'missing' } as const

type CoverState = (typeof COVER_STATES)[keyof typeof COVER_STATES]

type AlbumArtProps = { cover: Cover | null; size: number; initial: string }

type CoverLetterProps = AlbumArtProps

/** The album's first letter, dead center on the frame: the skeleton while a cover loads, the whole face when there is none. */
function CoverLetter({ initial, size }: CoverLetterProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.letterFrame]}>
      <Text accessibilityElementsHidden style={[styles.letter, { fontSize: size / 2 }]}>
        {initial}
      </Text>
    </View>
  )
}

type CoverImageProps = AlbumArtProps

function CoverImage({ cover, size, initial }: CoverImageProps) {
  return (
    cover !== null && (
      <>
        <CoverLetter cover={cover} size={size} initial={initial} />
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={cover}
          style={{ width: size, height: size }}
        />
      </>
    )
  )
}

const COVER_FACES = {
  [COVER_STATES.shown]: CoverImage,
  [COVER_STATES.missing]: CoverLetter,
} as const satisfies Record<CoverState, ComponentType<AlbumArtProps>>

/** An album's cover, always square at `size`, on its first letter while it loads or when it has none. */
export function AlbumArt({ cover, size, initial }: AlbumArtProps) {
  const Face = COVER_FACES[cover === null ? COVER_STATES.missing : COVER_STATES.shown]
  return (
    <View style={[styles.art, { width: size, height: size }]}>
      <Face cover={cover} size={size} initial={initial} />
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
      <AlbumArt cover={cover} size={width} initial={album.title.slice(0, 1)} />
      <View>
        <Text style={styles.title}>{album.title}</Text>
        <Text style={styles.line}>{artists}</Text>
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
  letterFrame: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: PALETTE.muted },
  title: { color: PALETTE.text, fontSize: SIZES.text, fontWeight: 'normal' },
  line: { color: PALETTE.text, fontSize: SIZES.textSm, fontWeight: 'bold', opacity: 0.85 },
  pressed: { opacity: OPACITIES.pressed },
})
