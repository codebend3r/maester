import { Icon } from '@raven/native'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { TouchFactChips } from '@/layouts/FactChips'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { BINGE_COPY, type BingeCard, bingeArtLabelOf } from '@/queries/bingeCards'
import { cardLabelOf } from '@/queries/cards'
import type { RouteTarget } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { useReduceMotion } from '@/stores/reduceMotion'
import { pictureStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

const PRESSED_SCALE = 0.98

/** How much of the card the title art may take. */
const LOGO_SHARE = { width: 0.42, height: 0.24 } as const

/** Dark at the top for the title art, clear through the middle, dark at the foot under the words. */
const GRADIENT = { top: 0.55, topEnd: 0.25, from: 0.35, clear: 0, dark: 0.95 } as const

const SHADOW = { opacity: 0.25, offset: 4, radius: 12 } as const

const GRADIENT_ID = 'bingeFade'

const PLAY_SIZE = 24

const SYNOPSIS_LINES = 3

type BingeCardViewProps = {
  card: BingeCard
  width: number
  height: number
  onOpen: (target: RouteTarget) => void
}

/**
 * A binged show as a jumbo card, as the web's: its backdrop edge to edge, its title art at the
 * top left, which opens the show's page, a play badge at the top right, and over the foot its
 * year and length, the episode it is on, who stars in it, a few lines of its synopsis, the
 * picture's quality as chips, and how far along it is with what is left. Pressed, the card plays
 * the episode where it stopped.
 */
export const BingeCardView = ({ card, width, height, onOpen }: BingeCardViewProps) => {
  const styles = usePictureStyles()
  const isReduced = useReduceMotion((state) => state.isReduced)
  const ground = useTheme((theme) => theme.overPicture.ground)
  const text = useTheme((theme) => theme.overPicture.text)
  const logo = card.logo ?? null
  const chips = card.chips ?? []
  return (
    <Pressable
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      onPress={() => onOpen(card.target)}
      style={({ pressed }) => [
        styles.card,
        { width, height },
        pressed && styles.pressed,
        pressed && !isReduced && styles.settled,
      ]}
    >
      <View style={styles.clip}>
        {card.picture !== null && (
          <Image
            accessibilityElementsHidden
            resizeMode="cover"
            source={card.picture}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Svg height={height} style={StyleSheet.absoluteFill} width={width}>
          <Defs>
            <LinearGradient id={GRADIENT_ID} x1="0" x2="0" y1="0" y2="1">
              <Stop offset={0} stopColor={ground} stopOpacity={GRADIENT.top} />
              <Stop offset={GRADIENT.topEnd} stopColor={ground} stopOpacity={GRADIENT.clear} />
              <Stop offset={GRADIENT.from} stopColor={ground} stopOpacity={GRADIENT.clear} />
              <Stop offset={1} stopColor={ground} stopOpacity={GRADIENT.dark} />
            </LinearGradient>
          </Defs>
          <Rect fill={`url(#${GRADIENT_ID})`} height={height} width={width} x={0} y={0} />
        </Svg>
        <Pressable
          accessibilityLabel={bingeArtLabelOf(card)}
          accessibilityRole="link"
          hitSlop={SIZES.space2}
          onPress={() => onOpen(card.page)}
          style={({ pressed }) => [styles.art, pressed && styles.pressed]}
        >
          {logo === null && (
            <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.show}>
              {card.title}
            </Text>
          )}
          {logo !== null && (
            <Image
              resizeMethod="resize"
              resizeMode="contain"
              source={logo}
              style={[
                styles.logoShadow,
                { width: width * LOGO_SHARE.width, height: height * LOGO_SHARE.height },
              ]}
            />
          )}
        </Pressable>
        <View pointerEvents="none" style={styles.words}>
          {card.meta !== null && (
            <Text numberOfLines={1} style={styles.meta}>
              {card.meta}
            </Text>
          )}
          {card.episodeLine !== null && (
            <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.episode}>
              {card.episodeLine}
            </Text>
          )}
          {card.stars !== null && (
            <Text numberOfLines={1} style={styles.starring}>
              {`${BINGE_COPY.starring} ${card.stars}`}
            </Text>
          )}
          {card.synopsis !== null && (
            <Text numberOfLines={SYNOPSIS_LINES} style={styles.synopsis}>
              {card.synopsis}
            </Text>
          )}
          {chips.length > 0 && <TouchFactChips parts={chips} />}
          {card.status !== null && (
            <View style={styles.progress}>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${card.progress * 100}%` }]} />
              </View>
              <Text numberOfLines={1} style={styles.status}>
                {card.status}
              </Text>
            </View>
          )}
        </View>
        <View pointerEvents="none" style={styles.badge}>
          <Icon colour={text} name={APP_ICONS.play} size={PLAY_SIZE} />
        </View>
      </View>
    </Pressable>
  )
}

const usePictureStyles = pictureStyles((colours) =>
  StyleSheet.create({
    card: {
      borderRadius: SIZES.radiusLg,
      backgroundColor: colours.raised,
      shadowColor: colours.ground,
      shadowOpacity: SHADOW.opacity,
      shadowRadius: SHADOW.radius,
      shadowOffset: { width: 0, height: SHADOW.offset },
      elevation: SHADOW.offset,
    },
    pressed: { opacity: OPACITIES.pressed },
    settled: { transform: [{ scale: PRESSED_SCALE }] },
    clip: { flex: 1, borderRadius: SIZES.radiusLg, overflow: 'hidden' },
    art: { position: 'absolute', top: SIZES.space3, left: SIZES.space3, right: SIZES.space3 },
    logoShadow: {
      shadowColor: colours.ground,
      shadowOpacity: 0.7,
      shadowRadius: SIZES.space1,
      shadowOffset: { width: 0, height: SHADOW.offset / 2 },
    },
    show: { color: colours.text, fontSize: SIZES.textLg, lineHeight: SIZES.textLg * LINE_RATIO },
    words: {
      position: 'absolute',
      left: SIZES.space3,
      right: SIZES.space3,
      bottom: SIZES.space3,
      gap: SIZES.space1,
    },
    meta: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    episode: { color: colours.text, fontSize: SIZES.textLg, lineHeight: SIZES.textLg * LINE_RATIO },
    starring: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      lineHeight: SIZES.textSm * LINE_RATIO,
    },
    synopsis: {
      color: colours.text,
      fontSize: SIZES.textSm,
      lineHeight: SIZES.textSm * LINE_RATIO,
    },
    progress: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    bar: {
      flex: 1,
      height: SIZES.space1,
      borderRadius: SIZES.radiusPill,
      overflow: 'hidden',
      backgroundColor: colours.track,
    },
    status: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    badge: {
      position: 'absolute',
      top: SIZES.space3,
      right: SIZES.space3,
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      borderRadius: SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.raised,
    },
    fill: { height: '100%', backgroundColor: colours.played, borderRadius: SIZES.radiusPill },
  }),
)
