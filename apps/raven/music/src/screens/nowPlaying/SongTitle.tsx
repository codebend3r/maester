import { Pressable, type StyleProp, Text, type TextStyle, View } from 'react-native'

import { KIT_COPY, NOW_PLAYING_COPY } from '@raven/wren'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { PLAYER_SIZES, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  title: { gap: SPACE.s1 / 2 },
  name: { ...TYPE.albumTitle, color: colors.text },
  artist: { ...TYPE.playerArtist, color: colors.text2 },
  compact: { alignItems: 'center', flexDirection: 'row', gap: SIZE.rowGap },
  compactText: { flex: 1, gap: SPACE.s1 / 2 },
  compactName: { ...TYPE.compactTitle, color: colors.text },
  compactArtist: { ...TYPE.body, color: colors.text2 },
  error: { ...TYPE.meta, color: colors.accentText },
  quality: { ...TYPE.meta, color: colors.text3 },
}))

type SongProps = { playing: Playing }

type ArtistLinkProps = SongProps & { style: StyleProp<TextStyle> }

/** The song's artists, a link to the first one's page when it is known. */
function ArtistLink({ playing, style }: ArtistLinkProps) {
  const { openArtist } = playing
  return (
    <Pressable
      accessibilityRole={openArtist === null ? 'text' : 'link'}
      disabled={openArtist === null}
      onPress={() => openArtist?.()}
      style={pressedStyleOf({ style: null })}
    >
      <Text numberOfLines={1} style={style}>
        {playing.artists}
      </Text>
    </Pressable>
  )
}

/** What went wrong playing, said under the song while it stands. */
function PlayError({ playing }: SongProps) {
  const styles = useStyles()
  return (
    playing.error !== null && (
      <Text accessibilityLiveRegion="polite" style={styles.error}>
        {playing.error}
      </Text>
    )
  )
}

/** The format and quality of what is playing, under the song once its source is made. */
function Quality({ playing }: SongProps) {
  const styles = useStyles()
  return (
    playing.quality !== null && (
      <Text
        accessibilityLabel={KIT_COPY.labelled({
          label: NOW_PLAYING_COPY.quality,
          value: playing.quality,
        })}
        numberOfLines={1}
        style={styles.quality}
      >
        {playing.quality}
      </Text>
    )
  )
}

/** How the song's lines are set: large under the cover, or small beside a small one. */
const SONG_VARIANTS = { large: 'large', compact: 'compact' } as const

type SongVariant = (typeof SONG_VARIANTS)[keyof typeof SONG_VARIANTS]

type SongLinesProps = SongProps & { variant: SongVariant }

/** The song in words: its title, its artists, what it plays as and what went wrong playing it. */
function SongLines({ playing, variant }: SongLinesProps) {
  const styles = useStyles()
  const lines = {
    [SONG_VARIANTS.large]: {
      box: styles.title,
      name: styles.name,
      artist: styles.artist,
      nameLines: 2,
    },
    [SONG_VARIANTS.compact]: {
      box: styles.compactText,
      name: styles.compactName,
      artist: styles.compactArtist,
      nameLines: 1,
    },
  } as const
  const { box, name, artist, nameLines } = lines[variant]
  return (
    <View style={box}>
      <Text accessibilityRole="header" numberOfLines={nameLines} style={name}>
        {playing.track.title}
      </Text>
      <ArtistLink playing={playing} style={artist} />
      <Quality playing={playing} />
      <PlayError playing={playing} />
    </View>
  )
}

/** The player's song: its title large in Young Serif, and its artists as a link. */
export function SongTitle({ playing }: SongProps) {
  return <SongLines playing={playing} variant={SONG_VARIANTS.large} />
}

/** Lyrics' and Up next's head: a small cover beside the song's title and artists. */
export function CompactSong({ playing }: SongProps) {
  const styles = useStyles()
  return (
    <View style={styles.compact}>
      <AlbumArt cover={playing.cover} radius={RADIUS.sm} size={PLAYER_SIZES.compactArt} />
      <SongLines playing={playing} variant={SONG_VARIANTS.compact} />
    </View>
  )
}
