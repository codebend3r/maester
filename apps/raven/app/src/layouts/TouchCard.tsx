import { type ComponentType, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { type ShelfCard, cardLabelOf } from '@/queries/cards'
import { CardPicture } from '@/layouts/Card'
import { ResumeCard } from '@/layouts/ResumeCard'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** How tall a touch card's caption stands, from its picture's foot: its title, then its line. */
export const touchCaptionHeightOf = (fontScale: number): number =>
  SIZES.space1 + linesHeightOf({ sizes: [SIZES.textSm, SIZES.textXs], fontScale })

type TouchCardProps = {
  card: ShelfCard
  width: number
  onPress: () => void
}

/** How a card is drawn: a picture with its words beneath, or a resume card with them over it. */
const CARD_LOOKS = { plain: 'plain', resume: 'resume' } as const

type CardLook = (typeof CARD_LOOKS)[keyof typeof CARD_LOOKS]

/** Whether a card has no caption under its picture: a resume card says its words over it. */
export const isCaptionless = (card: Pick<ShelfCard, 'resume'>): boolean => !!card.resume

/**
 * A card under the thumb, on a shelf or in a grid: its picture, its title and its line. A card
 * with title art wears it on the picture in the title's place, so the words are left out unless
 * the art fails to load; the card is still named for screen readers.
 */
const PlainCard = ({ card, width, onPress }: TouchCardProps) => {
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const styles = useStyles()
  const logo = card.logo ?? null
  const hasLogo = logo !== null && logo.uri !== failedLogo
  return (
    <Pressable
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <CardPicture card={card} onLogoError={() => setFailedLogo(logo?.uri ?? null)} width={width} />
      <View>
        {!hasLogo && (
          <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.title}>
            {card.title}
          </Text>
        )}
        {card.line !== null && (
          <Text numberOfLines={1} style={styles.line}>
            {card.line}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

const CARD_VIEWS = {
  [CARD_LOOKS.plain]: PlainCard,
  [CARD_LOOKS.resume]: ResumeCard,
} as const satisfies Record<CardLook, ComponentType<TouchCardProps>>

export const TouchCard = (props: TouchCardProps) => {
  const Look = CARD_VIEWS[isCaptionless(props.card) ? CARD_LOOKS.resume : CARD_LOOKS.plain]
  return <Look {...props} />
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    card: { gap: SIZES.space1 },
    pressed: { opacity: OPACITIES.pressed },
    title: {
      color: colours.text,
      fontSize: SIZES.textSm,
      lineHeight: SIZES.textSm * LINE_RATIO,
      fontWeight: '600',
    },
    line: { color: colours.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * LINE_RATIO },
  }),
)
