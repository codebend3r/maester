import { Text, View } from 'react-native'

import { type Cover } from '@raven/wren-native'
import { KIT_COPY } from '@raven/wren'

import { SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { Focusable } from '@/ui/Focusable'

const useStyles = themedStyles(({ colors }) => ({
  tile: { gap: SPACE.s2 },
  words: { gap: SPACE.s1 / 2 },
  title: { ...TYPE.tileTitle, color: colors.text },
  line: { ...TYPE.tileLine, color: colors.text2 },
  lit: { color: colors.accentText },
  lifted: { transform: [{ scale: SIZE.focusScale }] },
}))

const isWords = (words: string | null): words is string => words !== null

type TileProps = {
  title: string
  /** The line under it: the artists, or a count. */
  line: string | null
  /** A third line, read out after the second: Home's date. */
  detail?: string | null
  cover: Cover | null
  /** What it is called aloud, where the place reads less than its lines: an artist by name. */
  label?: string
  width: number
  /** An artist's round photo, where an album's or a playlist's cover is square. */
  isRound?: boolean
  onPress: () => void
  onLongPress?: () => void
  hasPreferredFocus?: boolean
  testID?: string
}

/**
 * An album, an artist or a playlist as a tile: its picture over its name and a line, the whole
 * of it one control, read as "name, line". With the remote on it the picture lifts and the name
 * takes the accent, as an album tile does on every Wren.
 */
export function Tile({
  title,
  line,
  detail = null,
  cover,
  label: spoken,
  width,
  isRound = false,
  onPress,
  onLongPress,
  hasPreferredFocus,
  testID,
}: TileProps) {
  const styles = useStyles()
  const lines = [line, detail].filter(isWords)
  const label =
    spoken ?? lines.reduce((said, value) => KIT_COPY.labelled({ label: said, value }), title)
  return (
    <Focusable
      hasPreferredFocus={hasPreferredFocus}
      hasRing={false}
      label={label}
      onLongPress={onLongPress}
      onPress={onPress}
      style={[styles.tile, { width }]}
      testID={testID}
    >
      {({ isFocused }) => (
        <>
          <View style={isFocused && styles.lifted}>
            <AlbumArt cover={cover} isRound={isRound} size={width} />
          </View>
          <View style={styles.words}>
            <Text numberOfLines={1} style={[styles.title, isFocused && styles.lit]}>
              {title}
            </Text>
            {lines.map((words) => (
              <Text key={words} numberOfLines={1} style={styles.line}>
                {words}
              </Text>
            ))}
          </View>
        </>
      )}
    </Focusable>
  )
}
