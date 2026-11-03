import type { IconName } from '@raven/ui/iconDrawings'
import { Icon } from '@raven/native'
import { useIsFocused } from 'expo-router'
import {
  type ComponentRef,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'

import { FocusBand } from '@/layouts/FocusBand'
import { useFocusOnMount, useOpenerFocus, useOpeningFocus } from '@/layouts/focus'
import { BUTTON_TONES, type ButtonTone } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import {
  FAN_PLACES,
  type FanPlace,
  HERO_COPY,
  HERO_MS,
  type HeroKit,
  type HeroTurn,
  type HomeHeroProps,
  TITLE_SIZES,
  type TitleSize,
  fanOffsetOf,
  fanPlaceOf,
  isInFan,
  isInWash,
  stepTurn,
  titleSizeOf,
} from '@/layouts/heroKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import type { Picture } from '@/queries/cards'
import type { HeroSlide } from '@/queries/heroSlides'
import { useReduceMotion } from '@/stores/reduceMotion'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The web's motion: the backdrop fades over 800 ms, the words over 400, the posters move over 600. */
const MOTION_MS = { wash: 800, words: 400, fan: 600 } as const

const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1)

/** The front poster's width, as the web's fan at its widest. */
const POSTER_WIDTH = tvSize(340)

const POSTER_HEIGHT = POSTER_WIDTH * 1.5

/** The fan's box: room for the posters tilted out to either side of the front one. */
const FAN_WIDTH = POSTER_WIDTH * 2.3

const FAN_HEIGHT = POSTER_WIDTH * 1.62

/** The wash behind the fan, as the web's: its backdrop blurred to a colour and faded at its edges. */
const WASH = { width: tvSize(1000), height: tvSize(760), blur: 24, glow: 0.55 } as const

const WASH_GRADIENT_ID = 'hero-wash'

/** How each place in the fan stands, its offsets in front posters' widths, as the web's. */
type Pose = { x: number; y: number; rotate: number; scale: number; opacity: number; z: number }

const FAN_POSES = {
  [FAN_PLACES.front]: { x: 0, y: 0.03, rotate: 0, scale: 1, opacity: 1, z: 3 },
  [FAN_PLACES.next]: { x: 0.54, y: 0, rotate: 8, scale: 0.73, opacity: 0.7, z: 2 },
  [FAN_PLACES.previous]: { x: -0.54, y: 0.02, rotate: -9, scale: 0.73, opacity: 0.7, z: 1 },
  [FAN_PLACES.away]: { x: 0, y: 0.1, rotate: 0, scale: 0.6, opacity: 0, z: 0 },
} as const satisfies Record<FanPlace, Pose>

const TITLE_FONT_SIZES = {
  [TITLE_SIZES.display]: tvSize(76),
  [TITLE_SIZES.long]: tvSize(60),
  [TITLE_SIZES.longest]: tvSize(46),
} as const satisfies Record<TitleSize, number>

const LINE_RATIO = 1.35

type UseEasedProps = { value: Animated.Value; toValue: number; duration: number }

/** Moves `value` to `toValue` over `duration`, or at once when the system asks for less motion. */
const useEased = ({ value, toValue, duration }: UseEasedProps): void => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  useEffect(() => {
    if (isReduced) {
      value.setValue(toValue)
      return undefined
    }
    const animation = Animated.timing(value, {
      toValue,
      duration,
      easing: EASE_OUT,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [value, toValue, duration, isReduced])
}

type WashPictureProps = { picture: Picture; isShown: boolean }

/** One backdrop in the wash, fading in as its title comes up and out as it goes. */
const WashPicture = ({ picture, isShown }: WashPictureProps) => {
  const [opacity] = useState(() => new Animated.Value(0))
  useEased({ value: opacity, toValue: isShown ? WASH.glow : 0, duration: MOTION_MS.wash })
  const styles = useStyles()
  return (
    <Animated.Image
      accessibilityElementsHidden
      blurRadius={WASH.blur}
      importantForAccessibility="no-hide-descendants"
      resizeMode="cover"
      source={picture}
      style={[styles.washPicture, { opacity }]}
    />
  )
}

type WashProps = { slides: readonly HeroSlide[]; turn: HeroTurn }

/** The backdrops behind the fan, faded into the ground at their edges. */
const Wash = ({ slides, turn }: WashProps) => {
  const ground = useTheme((theme) => theme.palette.ground)
  const styles = useStyles()
  return (
    <View pointerEvents="none" style={styles.wash}>
      {slides
        .map((slide, index) => ({ slide, index }))
        .filter(({ index }) => isInWash({ index, turn, count: slides.length }))
        .map(({ slide, index }) => (
          <WashPicture key={slide.key} isShown={index === turn.at} picture={slide.backdrop} />
        ))}
      <Svg height={WASH.height} style={StyleSheet.absoluteFill} width={WASH.width}>
        <Defs>
          <RadialGradient id={WASH_GRADIENT_ID} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset={0} stopColor={ground} stopOpacity={0} />
            <Stop offset={0.55} stopColor={ground} stopOpacity={0.35} />
            <Stop offset={1} stopColor={ground} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect
          fill={`url(#${WASH_GRADIENT_ID})`}
          height={WASH.height}
          width={WASH.width}
          x={0}
          y={0}
        />
      </Svg>
    </View>
  )
}

type FanPosterProps = { picture: Picture; place: FanPlace }

/** A poster in the fan, moving to its place as the turns go by. */
const FanPoster = ({ picture, place }: FanPosterProps) => {
  const pose = FAN_POSES[place]
  const [values] = useState(() => ({
    x: new Animated.Value(pose.x),
    y: new Animated.Value(pose.y),
    rotate: new Animated.Value(pose.rotate),
    scale: new Animated.Value(pose.scale),
    opacity: new Animated.Value(pose.opacity),
  }))
  useEased({ value: values.x, toValue: pose.x, duration: MOTION_MS.fan })
  useEased({ value: values.y, toValue: pose.y, duration: MOTION_MS.fan })
  useEased({ value: values.rotate, toValue: pose.rotate, duration: MOTION_MS.fan })
  useEased({ value: values.scale, toValue: pose.scale, duration: MOTION_MS.fan })
  useEased({ value: values.opacity, toValue: pose.opacity, duration: MOTION_MS.fan })
  const styles = useStyles()
  return (
    <Animated.View
      style={[
        styles.poster,
        {
          zIndex: pose.z,
          elevation: pose.z,
          opacity: values.opacity,
          transform: [
            { translateX: Animated.multiply(values.x, POSTER_WIDTH) },
            { translateY: Animated.multiply(values.y, POSTER_WIDTH) },
            {
              rotate: values.rotate.interpolate({
                inputRange: [-360, 360],
                outputRange: ['-360deg', '360deg'],
              }),
            },
            { scale: values.scale },
          ],
        },
      ]}
    >
      <Image resizeMode="cover" source={picture} style={styles.posterPicture} />
    </Animated.View>
  )
}

type FanProps = { slides: readonly HeroSlide[]; at: number }

/** Every poster in one box: the one up in front, the ones before and after tilted out behind. */
const Fan = ({ slides, at }: FanProps) => {
  const count = slides.length
  const styles = useStyles()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.fan}
    >
      {slides
        .map((slide, index) => ({ slide, offset: fanOffsetOf({ index, at, count }) }))
        .filter(({ offset }) => isInFan({ offset, count }))
        .map(({ slide, offset }) => (
          <FanPoster key={slide.key} picture={slide.poster} place={fanPlaceOf({ offset, count })} />
        ))}
    </View>
  )
}

type WordsProps = { slide: HeroSlide }

/** The title up: where it came, its name, its line and what it is, fading in as it comes. */
const Words = ({ slide }: WordsProps) => {
  const [opacity] = useState(() => new Animated.Value(0))
  useEased({ value: opacity, toValue: 1, duration: MOTION_MS.words })
  const styles = useStyles()
  const titleSize = TITLE_FONT_SIZES[titleSizeOf(slide.title)]
  return (
    <Animated.View style={[styles.words, { opacity }]}>
      <View style={styles.eyebrow}>
        <View style={styles.rule} />
        <Text style={styles.eyebrowLabel}>{slide.eyebrow.toUpperCase()}</Text>
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.1 }]}
        variant={TEXT_VARIANTS.display}
      >
        {slide.title}
      </Text>
      <Text numberOfLines={3} style={styles.line}>
        {slide.line ?? ''}
      </Text>
      {slide.facts.length > 0 && (
        <Text style={styles.facts}>{slide.facts.join(HERO_COPY.separator)}</Text>
      )}
    </Animated.View>
  )
}

type HeroButtonProps = {
  place: string
  label: string
  icon: IconName | null
  text: string | null | null
  tone: ButtonTone
  isPreferred?: boolean
  onFocused: () => void
  onBlurred: () => void
  onPress: () => void
}

type ButtonViewProps = { view: RefObject<ComponentRef<typeof Pressable> | null>; isAsked: boolean }

/** Asks the remote's focus for Play once it is drawn, where Home opens on it. */
const AskOnMount = ({ view, isAsked }: ButtonViewProps): ReactNode => {
  useFocusOnMount({ view, isAsked })
  return null
}

/**
 * A button in the hero, as the item page's actions: its icon with its few words, filled in the
 * primary tone for Play, ringed while focused. Pressed, it remembers itself as the opener, so
 * Back lands on it again.
 */
const HeroButton = ({
  place,
  label,
  icon,
  text,
  tone,
  isPreferred = false,
  onFocused,
  onBlurred,
  onPress,
}: HeroButtonProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { remember } = useOpenerFocus({ place, view })
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const toneStyles = useToneStyles()
  const palette = useTheme((theme) => theme.palette)
  const colour = tone === BUTTON_TONES.primary ? palette.onAccent : palette.text
  return (
    <>
      <AskOnMount isAsked={isPreferred} view={view} />
      <Pressable
        ref={view}
        accessibilityLabel={label}
        accessibilityRole="button"
        hasTVPreferredFocus={isPreferred}
        onBlur={onBlurred}
        onFocus={() => {
          settle()
          onFocused()
        }}
        onPress={() => {
          remember()
          onPress()
        }}
        style={({ focused }) => [
          styles.button,
          toneStyles[tone].button,
          focused && styles.focusedButton,
        ]}
      >
        {({ focused }) => (
          <>
            {icon !== null && (
              <Icon
                colour={colour}
                isFocused={focused}
                name={icon}
                size={text === null ? TV_SIZES.textXl : TV_SIZES.textLg}
              />
            )}
            {text !== null && (
              <Text style={[styles.buttonLabel, toneStyles[tone].label]}>{text}</Text>
            )}
          </>
        )}
      </Pressable>
    </>
  )
}

/**
 * Home's hero on a TV, as the web's: the titles the server features in turn, each with its words,
 * Play and Details, beside a fan of the posters before and after it, its backdrop washing the
 * ground behind. It moves on every few seconds while the remote is elsewhere and Home is in
 * front, and holds still while the remote is on it, or when the system asks for less motion;
 * Previous and Next step through by hand. Play takes the remote's focus as Home opens.
 */
const HomeHero = ({ slides, onOpen, isPreferred }: HomeHeroProps) => {
  const count = slides.length
  const [turn, setTurn] = useState<HeroTurn>({ at: 0, from: null })
  const [isFocusedIn, setFocusedIn] = useState(false)
  const isReduced = useReduceMotion((state) => state.isReduced)
  const isInFront = useIsFocused()
  const { isOpening } = useOpeningFocus()
  const styles = useStyles()
  const at = turn.at % Math.max(count, 1)
  const isHeld = isReduced || isFocusedIn || !isInFront || count < 2

  useEffect(() => {
    if (isHeld) return undefined
    const timer = setTimeout(
      () => setTurn(stepTurn({ turn: { at, from: null }, by: 1, count })),
      HERO_MS,
    )
    return () => clearTimeout(timer)
  }, [isHeld, at, count])

  const slide = slides[at]
  if (slide === undefined) return null

  const { play } = slide
  const step = (by: number) => setTurn(stepTurn({ turn: { at, from: null }, by, count }))
  const focus = { onFocused: () => setFocusedIn(true), onBlurred: () => setFocusedIn(false) }

  return (
    <View accessibilityLabel={HERO_COPY.featured} style={styles.hero}>
      <Wash slides={slides} turn={{ at, from: turn.from }} />
      <View style={styles.column}>
        <Words key={slide.key} slide={slide} />
        <FocusBand>
          <View style={styles.buttons}>
            {play !== null && (
              <HeroButton
                {...focus}
                icon="play"
                isPreferred={isOpening && isPreferred}
                label={HERO_COPY.playTitle(slide.title)}
                onPress={() => onOpen(play)}
                place="hero/play"
                text={HERO_COPY.play}
                tone={BUTTON_TONES.primary}
              />
            )}
            <HeroButton
              {...focus}
              icon={null}
              isPreferred={isOpening && isPreferred && play === null}
              label={HERO_COPY.detailsOf(slide.title)}
              onPress={() => onOpen(slide.details)}
              place="hero/details"
              text={HERO_COPY.details}
              tone={BUTTON_TONES.quiet}
            />
            {count > 1 && (
              <View style={styles.steps}>
                <HeroButton
                  {...focus}
                  icon="back"
                  label={HERO_COPY.previous}
                  onPress={() => step(-1)}
                  place="hero/previous"
                  text={null}
                  tone={BUTTON_TONES.ghost}
                />
                <HeroButton
                  {...focus}
                  icon="next"
                  label={HERO_COPY.next}
                  onPress={() => step(1)}
                  place="hero/next"
                  text={null}
                  tone={BUTTON_TONES.ghost}
                />
                <Text style={styles.counter}>{HERO_COPY.counter({ at: at + 1, count })}</Text>
              </View>
            )}
          </View>
        </FocusBand>
      </View>
      <Fan at={at} slides={slides} />
    </View>
  )
}

export const focusHero: HeroKit = { HomeHero }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space6,
      minHeight: FAN_HEIGHT + TV_SIZES.space6,
      paddingHorizontal: TV_GUTTER,
      paddingVertical: TV_SIZES.space4,
    },
    wash: {
      position: 'absolute',
      top: -TV_SIZES.space6,
      right: 0,
      width: WASH.width,
      height: WASH.height,
      overflow: 'hidden',
    },
    washPicture: { position: 'absolute', top: 0, left: 0, width: WASH.width, height: WASH.height },
    column: { flex: 1.1, gap: TV_SIZES.space5, justifyContent: 'center' },
    words: { gap: TV_SIZES.space3 },
    eyebrow: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space2 },
    rule: { width: TV_SIZES.space5, height: 1, backgroundColor: colours.muted },
    eyebrowLabel: {
      color: colours.muted,
      fontSize: TV_SIZES.textSm,
      fontWeight: '600',
      letterSpacing: tvSize(2),
    },
    title: { color: colours.text },
    line: {
      color: colours.muted,
      fontSize: TV_SIZES.textLg,
      lineHeight: TV_SIZES.textLg * LINE_RATIO,
      minHeight: TV_SIZES.textLg * LINE_RATIO * 3,
      maxWidth: TV_SIZES.measure * 1.4,
    },
    facts: { color: colours.muted, fontSize: TV_SIZES.text },
    buttons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      paddingVertical: TV_SIZES.space1,
    },
    steps: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space2,
      paddingLeft: TV_SIZES.space4,
    },
    button: {
      minHeight: TV_SIZES.controlLarge,
      minWidth: TV_SIZES.controlLarge,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space4,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
    },
    focusedButton: { borderColor: colours.text },
    buttonLabel: { fontSize: TV_SIZES.textLg, fontWeight: 'bold' },
    counter: { color: colours.muted, fontSize: TV_SIZES.textLg, paddingLeft: TV_SIZES.space1 },
    fan: { width: FAN_WIDTH, height: FAN_HEIGHT, alignItems: 'center' },
    poster: {
      position: 'absolute',
      top: 0,
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      borderRadius: TV_SIZES.radiusLg,
      overflow: 'hidden',
      backgroundColor: colours.raised,
    },
    posterPicture: { width: POSTER_WIDTH, height: POSTER_HEIGHT },
  }),
)
