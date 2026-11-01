import { Icon } from '@raven/native'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { CardPicture, pictureHeightOf } from '@/layouts/Card'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { type ShelfCard, cardLabelOf } from '@/queries/cards'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { useReduceMotion } from '@/stores/reduceMotion'
import { pictureStyles, useTheme } from '@/theme/useTheme'

/** A pressed card settles to this scale, where the system allows motion. */
const PRESSED_SCALE = 0.98

/** How much of the card the title art may take: wide and short, as title art runs. */
const LOGO_SHARE = { width: 0.5, height: 0.28 } as const

/**
 * The card's gradient: dark at the top so the title art reads on a bright picture, clear through
 * the middle, and dark at the foot under the words.
 */
const GRADIENT = { top: 0.5, topEnd: 0.3, from: 0.45, clear: 0, dark: 0.92 } as const

const SHADOW = { opacity: 0.25, offset: 4, radius: 12 } as const

const GRADIENT_ID = 'resumeFade'

const PLAY_SIZE = 20

type ResumeCardProps = {
  card: ShelfCard
  width: number
  onPress: () => void
}

/**
 * A card that resumes a video, as a streaming app's row draws it: the picture edge to edge on a
 * rounded, softly shadowed card, a fade to dark at its foot, the show's or film's title art
 * anchored to its top left over it, then the episode's name in the display face and its place with what is
 * left to watch, a glass play badge at the right and a thick progress line along the bottom.
 * Everything over the picture is in the player's on-picture colours, the same in every theme.
 */
export const ResumeCard = ({ card, width, onPress }: ResumeCardProps) => {
  const styles = usePictureStyles()
  const isReduced = useReduceMotion((state) => state.isReduced)
  const ground = useTheme((theme) => theme.overPicture.ground)
  const text = useTheme((theme) => theme.overPicture.text)
  const height = pictureHeightOf({ shape: card.shape, width })
  const logo = card.logo ?? null
  const episode = card.episode ?? null
  const timeLeft = card.resume?.timeLeft ?? null
  const mark = episode === null ? card.line : episode.mark
  return (
    <Pressable
      accessibilityLabel={cardLabelOf({ card })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width, height },
        pressed && styles.pressed,
        pressed && !isReduced && styles.settled,
      ]}
    >
      <View style={styles.clip}>
        <CardPicture
          card={{ ...card, logo: null, progress: 0 }}
          radius={SIZES.radiusLg}
          width={width}
        />
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
        {logo !== null && (
          <View pointerEvents="none" style={[styles.logoSlot, styles.logoShadow]}>
            <Image
              resizeMethod="resize"
              resizeMode="contain"
              source={logo}
              style={{ width: width * LOGO_SHARE.width, height: height * LOGO_SHARE.height }}
            />
          </View>
        )}
        <View pointerEvents="none" style={styles.words}>
          {logo === null && (
            <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.show}>
              {card.title}
            </Text>
          )}
          {episode !== null && (
            <Text variant={TEXT_VARIANTS.display} numberOfLines={1} style={styles.name}>
              {episode.name}
            </Text>
          )}
          <View style={styles.facts}>
            {mark !== null && (
              <Text numberOfLines={1} style={styles.mark}>
                {mark}
              </Text>
            )}
            {timeLeft !== null && (
              <Text numberOfLines={1} style={styles.mark}>
                {timeLeft}
              </Text>
            )}
          </View>
        </View>
        <View pointerEvents="none" style={styles.badge}>
          <Icon colour={text} name="play" size={PLAY_SIZE} />
        </View>
        <View pointerEvents="none" style={styles.track}>
          <View style={[styles.fill, { width: `${card.progress * 100}%` }]} />
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
    words: {
      position: 'absolute',
      left: SIZES.space3,
      right: SIZES.space3 * 2 + SIZES.fieldHeight,
      bottom: SIZES.space3 + SIZES.space1,
      gap: SIZES.space0,
    },
    logoSlot: { position: 'absolute', top: SIZES.space3, left: SIZES.space3 },
    logoShadow: {
      shadowColor: colours.ground,
      shadowOpacity: 0.7,
      shadowRadius: SIZES.space1,
      shadowOffset: { width: 0, height: SHADOW.offset / 2 },
    },
    show: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    name: { color: colours.text, fontSize: SIZES.text, lineHeight: SIZES.text * LINE_RATIO },
    facts: { flexDirection: 'row', justifyContent: 'space-between' },
    mark: { color: colours.muted, fontSize: SIZES.textXs, lineHeight: SIZES.textXs * LINE_RATIO },
    badge: {
      position: 'absolute',
      right: SIZES.space3,
      bottom: SIZES.space3 + SIZES.space1,
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      borderRadius: SIZES.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.raised,
    },
    track: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: SIZES.space1,
      backgroundColor: colours.track,
    },
    fill: { height: '100%', backgroundColor: colours.played, borderRadius: SIZES.radiusPill },
  }),
)
