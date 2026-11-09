import { type ComponentRef, type ComponentType, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native'

import { useTvCard } from '@/cardMenu/useTvCard'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { CARD_SHAPES, type CardShape, type ShelfCard, cardLabelOf } from '@/queries/cards'
import { CardPicture, watchedBadgeOf } from '@/layouts/Card'
import { FocusFactChips } from '@/layouts/FactChips'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { type JumpFocus, useJumpFocus } from '@/layouts/useJumpFocus'
import { useReduceMotion } from '@/stores/reduceMotion'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** A card's width in points on a 1920 by 1080 point screen, read from across the room. */
export const FOCUS_CARD_WIDTHS = {
  [CARD_SHAPES.poster]: 232,
  [CARD_SHAPES.wide]: 400,
  [CARD_SHAPES.square]: 232,
} as const

/** A card's width on this TV: its width on a 1920 point screen, sized to this one. */
export const focusCardWidthOf = (shape: CardShape): number => tvSize(FOCUS_CARD_WIDTHS[shape])

/** The watched check on a TV card, sized to the screen as the card's radius and ring are. */
export const TV_WATCHED_BADGE = watchedBadgeOf(TV_SIZES)

/**
 * How much the focused card stands above the rest: the rest are drawn at `REST_SCALE` of their
 * box and the focused one at its box's full size, so a card grows within its own box and never
 * over the card beside it. Standing it in front by `zIndex` instead moved it among its siblings,
 * which Fabric does by taking the view out and putting it back, and tvOS let the focus go to the
 * screen's first control as it went.
 */
const FOCUS_SCALE = 1.08

const REST_SCALE = 1 / FOCUS_SCALE

const GROW_MS = 150

// The web's `--ease-out`, `cubic-bezier(0.2, 0.8, 0.2, 1)`, which the native tokens cannot carry.
const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1)

/** How tall a focus card's caption stands, from its picture's foot: its title, then its line. */
export const focusCaptionHeightOf = (fontScale: number): number =>
  TV_SIZES.space3 + linesHeightOf({ sizes: [TV_SIZES.textLg, TV_SIZES.text], fontScale })

/** What leads a card's caption: an episode's name, the title in type, or nothing where title art says it. */
const CAPTION_TITLES = { episode: 'episode', words: 'words', art: 'art' } as const

type CaptionTitle = (typeof CAPTION_TITLES)[keyof typeof CAPTION_TITLES]

const captionTitleOf = (card: ShelfCard): CaptionTitle => {
  if (card.episode != null) return CAPTION_TITLES.episode
  return card.logo == null ? CAPTION_TITLES.words : CAPTION_TITLES.art
}

type CaptionTitleProps = { card: ShelfCard; isFocused: boolean }

const CaptionWords = ({ card, isFocused }: CaptionTitleProps) => {
  const styles = useStyles()
  return (
    <Text numberOfLines={1} style={[styles.title, isFocused && styles.focusedTitle]}>
      {card.title}
    </Text>
  )
}

const CaptionEpisode = ({ card, isFocused }: CaptionTitleProps) => {
  const styles = useStyles()
  return (
    <Text
      variant={TEXT_VARIANTS.display}
      numberOfLines={1}
      style={[styles.title, isFocused && styles.focusedTitle]}
    >
      {card.episode?.name ?? card.title}
    </Text>
  )
}

const CaptionArt = () => null

const CAPTION_TITLE_VIEWS = {
  [CAPTION_TITLES.episode]: CaptionEpisode,
  [CAPTION_TITLES.words]: CaptionWords,
  [CAPTION_TITLES.art]: CaptionArt,
} as const satisfies Record<CaptionTitle, ComponentType<CaptionTitleProps>>

type FocusCardProps = {
  card: ShelfCard
  place?: string
  /** The shelf the card sits on, for Home's shelves to bring into view as it takes the focus back; none in a grid. */
  shelf?: string | null
  width: number
  /** The picture's height over its width where the layout frames it otherwise than its shape. */
  ratio?: number
  isPreferred: boolean
  jump?: JumpFocus | null
  /** Whether the title and its line show under the picture; a grid of posters leaves them out. */
  hasCaption?: boolean
  onPress: () => void
}

/**
 * A card the remote moves to, on a shelf or in a grid: it grows to its box's full size and takes
 * the ring while focused, smoothly unless the system asks for less motion, when it changes at once.
 * `isPreferred` asks the remote's focus for it as the screen opens; `jump` takes the focus
 * once per jump that lands on it, and coming back to the screen takes it back to the card that
 * was pressed. `place` is where the card sits on its screen, unique there: the card's own key,
 * or more where one title can sit in two places. Taking the focus spends the screen's opening focus.
 * Select held down opens the card's menu of marks, for a card that stands for something.
 */
export const FocusCard = ({
  card,
  place = card.key,
  shelf = null,
  width,
  ratio,
  isPreferred,
  jump = null,
  hasCaption = true,
  onPress,
}: FocusCardProps) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  useJumpFocus({ jump, view: pressable })
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [scale] = useState(() => new Animated.Value(REST_SCALE))
  const tvCard = useTvCard({ card, place, shelf, view: pressable, onPress })
  const { isFocused } = tvCard
  const styles = useStyles()
  const CaptionTitle = CAPTION_TITLE_VIEWS[captionTitleOf(card)]
  const line = card.episode?.mark ?? card.line
  const chips = card.chips ?? []

  useEffect(() => {
    const toValue = isFocused ? 1 : REST_SCALE
    if (isReduced) {
      scale.setValue(toValue)
      return
    }
    Animated.timing(scale, {
      toValue,
      duration: GROW_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start()
  }, [isFocused, isReduced, scale])

  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onBlur={tvCard.onBlur}
      onFocus={tvCard.onFocus}
      onPress={tvCard.onPress}
    >
      <Animated.View style={[styles.card, { width, transform: [{ scale }] }]}>
        <CardPicture
          badge={TV_WATCHED_BADGE}
          card={card}
          ratio={ratio}
          radius={TV_SIZES.radius}
          ring={isFocused ? TV_SIZES.tvFocusRing : 0}
          width={width}
        />
        {hasCaption && (
          <View>
            <CaptionTitle card={card} isFocused={isFocused} />
            {line !== null && (
              <Text numberOfLines={1} style={styles.line}>
                {line}
              </Text>
            )}
            {chips.length > 0 && <FocusFactChips parts={chips} />}
          </View>
        )}
      </Animated.View>
      {tvCard.menu}
    </Pressable>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    card: { gap: TV_SIZES.space3 },
    title: {
      color: colours.muted,
      fontSize: TV_SIZES.textLg,
      lineHeight: TV_SIZES.textLg * LINE_RATIO,
      fontWeight: '600',
    },
    focusedTitle: { color: colours.text },
    line: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
  }),
)
