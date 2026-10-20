import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { ShelfCard } from '@/queries/cards'
import { CardPicture } from '@/layouts/Card'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** How tall a touch card's caption stands: its title, then its line. */
export const TOUCH_CAPTION_HEIGHT = SIZES.space1 + SIZES.textSm * 1.25 + SIZES.textXs * 1.25

/** A card under the thumb, on a shelf or in a grid: its picture, its title and its line. */
export const TouchCard = ({
  card,
  width,
  onPress,
}: {
  card: ShelfCard
  width: number
  onPress: () => void
}) => (
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

const styles = StyleSheet.create({
  card: { gap: SIZES.space1 },
  pressed: { opacity: 0.6 },
  title: {
    color: COLOURS.text,
    fontSize: SIZES.textSm,
    lineHeight: SIZES.textSm * 1.25,
    fontWeight: '600',
  },
  line: { color: COLOURS.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * 1.25 },
})
