import { Icon } from '@raven/native'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTouchCard } from '@/cardMenu/useTouchCard'
import { HERO_COPY, TITLE_SIZES, type TitleSize, titleSizeOf } from '@/layouts/heroKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import type { HeroSlide } from '@/queries/heroSlides'
import type { RouteTarget } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { pictureStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/**
 * The slide's gradient: a little dark at the top under the status bar, clear through the
 * middle, and dark at the foot under the words.
 */
const GRADIENT = { top: 0.45, topEnd: 0.2, from: 0.35, clear: 0, dark: 0.95 } as const

const GRADIENT_ID = 'heroFade'

/** How large a title is set, in the largest body size's steps, smaller for a long one. */
const TITLE_SCALES = {
  [TITLE_SIZES.display]: 1.3,
  [TITLE_SIZES.long]: 1.1,
  [TITLE_SIZES.longest]: 0.9,
} as const satisfies Record<TitleSize, number>

/** A tablet's title is set larger again, as the web's grows with the screen. */
const TABLET_TITLE_SCALE = 1.3

/** How many lines of the synopsis show before it is cut short. */
const LINE_CLAMP = 3

const PLAY_ICON_SIZE = 18

type HeroActionOfProps = { slide: HeroSlide }

type HeroAction = { label: string; text: string; target: RouteTarget; isPlay: boolean }

/** What the slide's button does: Play where there is something to play, else Details. */
const heroActionOf = ({ slide }: HeroActionOfProps): HeroAction =>
  slide.play === null
    ? {
        label: HERO_COPY.detailsOf(slide.title),
        text: HERO_COPY.details,
        target: slide.details,
        isPlay: false,
      }
    : {
        label: HERO_COPY.playTitle(slide.title),
        text: HERO_COPY.play,
        target: slide.play,
        isPlay: true,
      }

type HeroSlideViewProps = {
  slide: HeroSlide
  width: number
  height: number
  isTablet: boolean
  onOpen: (target: RouteTarget) => void
}

/**
 * One title of the touch hero, edge to edge: its backdrop under a fade to dark at the foot, where
 * it came, its name in the display face, its facts and its synopsis, and Play. The picture and
 * its words are one button that opens the title's page, as the TV's Details does; Play beside
 * it starts it, or opens the page where a show has nothing left to watch. A long press on the
 * picture opens the title's menu. Everything over the picture is in the on-picture colours, the
 * same in every theme.
 */
export const HeroSlideView = ({ slide, width, height, isTablet, onOpen }: HeroSlideViewProps) => {
  const { onLongPress, menu } = useTouchCard({ card: slide })
  const styles = usePictureStyles()
  const ground = useTheme((theme) => theme.overPicture.ground)
  const onAccent = useTheme((theme) => theme.palette.onAccent)
  const text = useTheme((theme) => theme.overPicture.text)
  const action = heroActionOf({ slide })
  const titleSize =
    SIZES.textXl * TITLE_SCALES[titleSizeOf(slide.title)] * (isTablet ? TABLET_TITLE_SCALE : 1)
  return (
    <View style={{ width, height }}>
      <Pressable
        accessibilityLabel={HERO_COPY.detailsOf(slide.title)}
        accessibilityRole="button"
        onLongPress={onLongPress}
        onPress={() => onOpen(slide.details)}
        style={StyleSheet.absoluteFill}
      >
        <Image resizeMode="cover" source={slide.backdrop} style={{ width, height }} />
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
        <View pointerEvents="none" style={styles.words}>
          <Text numberOfLines={1} style={styles.eyebrow}>
            {slide.eyebrow.toUpperCase()}
          </Text>
          <Text
            numberOfLines={2}
            style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.1 }]}
            variant={TEXT_VARIANTS.display}
          >
            {slide.title}
          </Text>
          {slide.facts.length > 0 && (
            <Text numberOfLines={1} style={styles.facts}>
              {slide.facts.join(HERO_COPY.separator)}
            </Text>
          )}
          {slide.line !== null && (
            <Text numberOfLines={LINE_CLAMP} style={[styles.line, isTablet && styles.wideLine]}>
              {slide.line}
            </Text>
          )}
        </View>
        {menu}
      </Pressable>
      <Pressable
        accessibilityLabel={action.label}
        accessibilityRole="button"
        onPress={() => onOpen(action.target)}
        style={({ pressed }) => [
          styles.button,
          action.isPlay ? styles.playButton : styles.quietButton,
          pressed && styles.pressed,
        ]}
      >
        {action.isPlay && <Icon colour={onAccent} name={APP_ICONS.play} size={PLAY_ICON_SIZE} />}
        <Text style={[styles.buttonLabel, { color: action.isPlay ? onAccent : text }]}>
          {action.text}
        </Text>
      </Pressable>
    </View>
  )
}

/** How far the words stand above the foot: the button's row and the dots under them. */
const WORDS_FOOT = SIZES.space4 + SIZES.fieldHeight + SIZES.space3

const usePictureStyles = pictureStyles((colours) =>
  StyleSheet.create({
    words: {
      position: 'absolute',
      left: SIZES.space4,
      right: SIZES.space4,
      bottom: WORDS_FOOT,
      gap: SIZES.space1,
    },
    eyebrow: {
      color: colours.muted,
      fontSize: SIZES.textXs,
      fontWeight: '600',
      letterSpacing: 1.5,
    },
    title: { color: colours.text },
    facts: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    line: { color: colours.text, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    wideLine: {
      maxWidth: SIZES.measure,
      fontSize: SIZES.text,
      lineHeight: SIZES.text * LINE_RATIO,
    },
    button: {
      position: 'absolute',
      left: SIZES.space4,
      bottom: SIZES.space4,
      minHeight: SIZES.fieldHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space1,
      paddingHorizontal: SIZES.space4,
      borderRadius: SIZES.radiusPill,
    },
    playButton: { backgroundColor: colours.accent },
    quietButton: { backgroundColor: colours.raised },
    pressed: { opacity: OPACITIES.pressed },
    buttonLabel: { fontSize: SIZES.text, fontWeight: 'bold' },
  }),
)
