import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import type { ShelfCard } from '@/queries/cards'
import { CardPicture } from '@/layouts/Card'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** How tall a touch card's caption stands, from its picture's foot: its title, then its line. */
export const touchCaptionHeightOf = (fontScale: number): number =>
  SIZES.space1 + linesHeightOf({ sizes: [SIZES.textSm, SIZES.textXs], fontScale })

/** A card under the thumb, on a shelf or in a grid: its picture, its title and its line. */
export const TouchCard = ({
  card,
  width,
  onPress,
}: {
  card: ShelfCard
  width: number
  onPress: () => void
}) => {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={card.title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <CardPicture card={card} width={width} />
      <View>
        <Text numberOfLines={1} style={styles.title}>
          {card.title}
        </Text>
        {card.line !== null && (
          <Text numberOfLines={1} style={styles.line}>
            {card.line}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    card: { gap: SIZES.space1 },
    pressed: { opacity: 0.6 },
    title: {
      color: colours.text,
      fontSize: SIZES.textSm,
      lineHeight: SIZES.textSm * LINE_RATIO,
      fontWeight: '600',
    },
    line: { color: colours.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * LINE_RATIO },
  }),
)
