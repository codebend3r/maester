import { Icon } from '@raven/native'
import { type ComponentRef, useRef, useState } from 'react'
import { Image, type LayoutRectangle, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTvCard } from '@/cardMenu/useTvCard'
import { FocusFactChips } from '@/layouts/FactChips'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { BINGE_COPY, type BingeCard } from '@/queries/bingeCards'
import { cardLabelOf } from '@/queries/cards'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { pictureStyles, useTheme } from '@/theme/useTheme'

/** The web card's `--color-shade`, black at 45%, laid on twice where its two gradients meet. */
const SHADE = 0.45

/** The web's shade: dark across the left third and clear by four fifths, dark along the foot and clear by three fifths. */
const SHADE_STOPS = { side: 0.35, sideClear: 0.8, footClear: 0.6 } as const

const GRADIENT_IDS = { side: 'bingeFocusSide', foot: 'bingeFocusFoot' } as const

/** The title art's room, as the web's: at most 44% of the card across and 5.5rem tall, at the TV's type boost. */
const LOGO = { share: 0.44, height: tvSize(128) } as const

/** The words' measure, the web's 40rem at the TV's type boost. */
const COPY_WIDTH = tvSize(928)

const PLAY_SIZE = tvSize(36)

type LogoWidthOfProps = { cardWidth: number; ratio: number | null }

/** The title art's width: its own at the slot's height, never past its share of the card. */
const logoWidthOf = ({ cardWidth, ratio }: LogoWidthOfProps): number => {
  const most = cardWidth * LOGO.share
  return ratio === null ? most : Math.min(most, LOGO.height * ratio)
}

const SYNOPSIS_LINES = 3

/** A soft shadow under the synopsis, which sits over the lightest part of the backdrop. */
const SYNOPSIS_SHADOW = { offset: tvSize(1), radius: tvSize(3) } as const

type BingeCardFocusProps = {
  card: BingeCard
  width: number
  /** The least the card stands; its words make it taller where they need the room. */
  height: number
  place: string
  /** The shelf the card sits on, Home's binge shelf, for the shelves to bring into view as it takes the focus back. */
  shelf: string
  isPreferred: boolean
  /** Whether the synopsis is set to the top right: the card across the width has the room, a half card not. */
  hasSynopsis: boolean
  onPress: () => void
}

/**
 * A binged show on a TV as the web's jumbo card: its backdrop under the web's shade, its title
 * art in the top left corner (or its name in the display face) with a few lines of the synopsis
 * set to the top right where the card has the room, and above the foot its year and length with
 * the picture's quality, the episode it is on, and Starring over its stars' names in the display
 * face, then how far along it is with what is left at the right. Focused, it takes the ring and
 * shows Play at its right, as the web's does on hover; pressed, it plays the episode, and
 * select held down opens the show's menu of marks.
 */
export const BingeCardFocus = ({
  card,
  width,
  height,
  place,
  shelf,
  isPreferred,
  hasSynopsis,
  onPress,
}: BingeCardFocusProps) => {
  const pressable = useRef<ComponentRef<typeof Pressable>>(null)
  // The shade is drawn at the card's measured size: a percentage left it short of a card its words had grown.
  const [frame, setFrame] = useState<Pick<LayoutRectangle, 'width' | 'height'>>({ width, height })
  // The title art's width over its height, once loaded, so it sits flush left as the web's `object-position: left top`.
  const [logoRatio, setLogoRatio] = useState<number | null>(null)
  const tvCard = useTvCard({ card, place, shelf, view: pressable, onPress })
  const { isFocused } = tvCard
  const styles = usePictureStyles()
  const shade = useTheme((theme) => theme.overPicture.ground)
  const ring = useTheme((theme) => theme.palette.text)
  const onAccent = useTheme((theme) => theme.palette.onAccent)
  const logo = card.logo ?? null
  const chips = card.chips ?? []
  return (
    <Pressable
      ref={pressable}
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      hasTVPreferredFocus={isPreferred}
      onBlur={tvCard.onBlur}
      onFocus={tvCard.onFocus}
      onPress={tvCard.onPress}
      onLayout={(event) => setFrame(event.nativeEvent.layout)}
      style={[styles.card, { width, minHeight: height }]}
    >
      <View style={styles.backdrop}>
        {card.picture !== null && (
          <Image
            accessibilityElementsHidden
            resizeMethod="resize"
            resizeMode="cover"
            source={card.picture}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Svg height={frame.height} style={StyleSheet.absoluteFill} width={frame.width}>
          <Defs>
            <LinearGradient id={GRADIENT_IDS.side} x1="0" x2="1" y1="0" y2="0">
              <Stop offset={0} stopColor={shade} stopOpacity={SHADE} />
              <Stop offset={SHADE_STOPS.side} stopColor={shade} stopOpacity={SHADE} />
              <Stop offset={SHADE_STOPS.sideClear} stopColor={shade} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id={GRADIENT_IDS.foot} x1="0" x2="0" y1="1" y2="0">
              <Stop offset={0} stopColor={shade} stopOpacity={SHADE} />
              <Stop offset={SHADE_STOPS.footClear} stopColor={shade} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect fill={`url(#${GRADIENT_IDS.side})`} height={frame.height} width={frame.width} />
          <Rect fill={`url(#${GRADIENT_IDS.foot})`} height={frame.height} width={frame.width} />
        </Svg>
      </View>
      <View style={styles.top}>
        {logo === null && (
          <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.show}>
            {card.title}
          </Text>
        )}
        {logo !== null && (
          <Image
            resizeMethod="resize"
            onLoad={(event) => {
              const { width: logoWidth, height: logoHeight } = event.nativeEvent.source
              setLogoRatio(logoHeight > 0 ? logoWidth / logoHeight : null)
            }}
            resizeMode="contain"
            source={logo}
            style={[styles.logo, { width: logoWidthOf({ cardWidth: width, ratio: logoRatio }) }]}
          />
        )}
        {hasSynopsis && card.synopsis !== null && (
          <Text numberOfLines={SYNOPSIS_LINES} style={styles.synopsis}>
            {card.synopsis}
          </Text>
        )}
      </View>
      <View style={styles.copy}>
        {(card.meta !== null || chips.length > 0) && (
          <FocusFactChips parts={chips}>
            {card.meta !== null && (
              <Text numberOfLines={1} style={styles.line}>
                {card.meta}
              </Text>
            )}
          </FocusFactChips>
        )}
        {card.episodeLine !== null && (
          <Text numberOfLines={1} style={styles.line}>
            {card.episodeLine}
          </Text>
        )}
        {card.stars !== null && (
          <View>
            <Text numberOfLines={1} style={styles.line}>
              {BINGE_COPY.starring}
            </Text>
            <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.stars}>
              {card.stars}
            </Text>
          </View>
        )}
      </View>
      {card.status !== null && (
        <View style={styles.progress}>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${card.progress * 100}%` }]} />
          </View>
          <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.status}>
            {card.status}
          </Text>
        </View>
      )}
      {isFocused && (
        <View pointerEvents="none" style={styles.markSlot}>
          <View style={styles.mark}>
            <Icon colour={onAccent} name="play" size={PLAY_SIZE} />
          </View>
        </View>
      )}
      {isFocused && <View pointerEvents="none" style={[styles.ring, { borderColor: ring }]} />}
      {tvCard.menu}
    </Pressable>
  )
}

const usePictureStyles = pictureStyles((colours) =>
  StyleSheet.create({
    card: {
      justifyContent: 'space-between',
      gap: TV_SIZES.space4,
      padding: TV_SIZES.space6,
      borderRadius: TV_SIZES.radiusLg,
      overflow: 'hidden',
      backgroundColor: colours.ground,
    },
    backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    top: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TV_SIZES.space6,
    },
    /*
     * Over the backdrop's lightest part, so in the on-picture text colour with a shadow under it.
     * No line height of its own: Android clips each line to the height set, which cut the shadow
     * off at the line below.
     */
    synopsis: {
      flexShrink: 1,
      maxWidth: COPY_WIDTH,
      color: colours.text,
      fontSize: TV_SIZES.text,
      textAlign: 'right',
      textShadowColor: colours.ground,
      textShadowOffset: { width: 0, height: SYNOPSIS_SHADOW.offset },
      textShadowRadius: SYNOPSIS_SHADOW.radius,
    },
    stars: {
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      lineHeight: TV_SIZES.textLg * LINE_RATIO,
    },
    logo: { height: LOGO.height, maxWidth: '100%' },
    show: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
    },
    copy: { alignItems: 'flex-start', gap: TV_SIZES.space2, maxWidth: COPY_WIDTH },
    line: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
    progress: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    bar: {
      flex: 1,
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.radiusPill,
      overflow: 'hidden',
      backgroundColor: colours.track,
    },
    fill: { height: '100%', backgroundColor: colours.played, borderRadius: TV_SIZES.radiusPill },
    status: {
      color: colours.text,
      fontSize: TV_SIZES.textSm,
      lineHeight: TV_SIZES.textSm * LINE_RATIO,
    },
    markSlot: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingRight: TV_SIZES.space6,
    },
    mark: {
      width: TV_SIZES.controlLarge,
      height: TV_SIZES.controlLarge,
      borderRadius: TV_SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.accent,
    },
    ring: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: TV_SIZES.tvFocusRing,
      borderRadius: TV_SIZES.radiusLg,
    },
  }),
)
