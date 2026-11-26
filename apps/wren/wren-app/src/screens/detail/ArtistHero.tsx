import { type ReactNode, useState } from 'react'
import {
  Image,
  type ImageLoadEvent,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import type { ArtistAbout } from '@raven/core'
import { ARTIST_COPY, DETAIL_COPY, aboutFactsOf, hasAbout, ON_PICTURE } from '@raven/wren'
import { type Cover } from '@raven/wren-native'
import { BackButton } from '@/screens/detail/BackButton'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { DETAIL_SIZES, SIZE, SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { ArtistAvatar } from '@/ui/ArtistAvatar'
import { IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'

/** The hero's height on each form factor. */
const HERO_HEIGHTS = {
  [FORM_FACTORS.phone]: DETAIL_SIZES.hero,
  [FORM_FACTORS.tablet]: DETAIL_SIZES.tabletHero,
} as const satisfies Record<FormFactor, number>

// The fade to the ground covers this share of the hero, from its foot.
const FADE_SHARE = 0.47

// The fallback's circle, as shares of the hero's height: its size and how far it hangs off.
const SHAPE = { size: 1.2, right: -0.3, top: -0.27 } as const

const FADE_ID = 'artist-hero-fade'
const SEAM_ID = 'artist-hero-seam'

/* On a wide hero the photo keeps to the end at its own shape, but never narrower than this many
   hero heights, so a square photo is cropped to a face rather than a band of forehead, and a
   blurred copy of it fills the rest. */
const PHOTO_RATIO = 1.5

// How many lines of the bio show before it is cut.
const BIO_LINES = 4

// The photo's start edge fades into the blurred copy over this share of the photo.
const SEAM_SHARE = 0.4

// How much of the ground veils the blurred copy and the seam.
const BACKDROP_VEIL = 0.4

type PhotoWidthProps = { heroWidth: number; height: number; aspect: number }

/** The photo's width on a hero this wide: the whole hero, or its own shape kept to the end. */
const photoWidthOf = ({ heroWidth, height, aspect }: PhotoWidthProps): number =>
  Math.min(heroWidth, height * Math.max(PHOTO_RATIO, aspect))

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  hero: { backgroundColor: colors.surface, overflow: 'hidden' },
  shape: { position: 'absolute' },
  photo: { bottom: 0, position: 'absolute', right: 0, top: 0 },
  seam: { position: 'absolute', top: 0 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: SPACE.s2,
    position: 'absolute',
    right: SPACE.s3,
  },
  foot: {
    alignItems: 'flex-end',
    bottom: SPACE.s4,
    flexDirection: 'row',
    gap: SPACE.s4,
    position: 'absolute',
  },
  names: { flex: 1 },
  name: { ...TYPE.artistName, color: colors.text },
  meta: { ...TYPE.time, color: colors.text2 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  about: { gap: SPACE.s3, position: 'absolute' },
  bio: { ...TYPE.body, color: ON_PICTURE.ink },
  facts: { gap: SPACE.s1 },
  fact: { alignItems: 'baseline', flexDirection: 'row', gap: SPACE.s2 },
  factLabel: { ...TYPE.overline, color: ON_PICTURE.ink },
  factValue: { ...TYPE.small, color: ON_PICTURE.ink, flexShrink: 1 },
}))

type ArtistHeroProps = {
  name: string
  /** "8 albums · 132 songs". */
  meta: string
  /** The artist's photo, or null for the fallback: a shape holding their initial. */
  photo: Cover | null
  onMore: () => void
  /** What sits at the foot's end: `HeroActions` on a tablet, nothing on a phone. */
  actions: ReactNode
  /** The page's side margins, so the name lines up with what follows. */
  sides: number
  /** Who the artist is, told beside a wide hero's photo; null until it is known. */
  about: ArtistAbout | null
}

type HeroActionsProps = { children: ReactNode }

type AboutProps = { about: ArtistAbout; top: number; left: number; width: number }

/** The artist's bio and facts, over the blurred photo at the head's start. */
function About({ about, top, left, width }: AboutProps) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={ARTIST_COPY.about} style={[styles.about, { left, top, width }]}>
      {about.bio !== null && (
        <Text numberOfLines={BIO_LINES} style={styles.bio}>
          {about.bio}
        </Text>
      )}
      <View style={styles.facts}>
        {aboutFactsOf(about).map(({ label, value }) => (
          <View key={label} style={styles.fact}>
            <Text style={styles.factLabel}>{label}</Text>
            <Text numberOfLines={1} style={styles.factValue}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** Which way a fade runs: down the hero, or across it from the start edge. */
const FADE_DIRECTIONS = { down: 'down', across: 'across' } as const

type FadeDirection = (typeof FADE_DIRECTIONS)[keyof typeof FADE_DIRECTIONS]

type FadeEnd = { x2: string; y2: string }

/** The gradient's end point for each direction, from its start at the top left. */
const FADE_ENDS = {
  [FADE_DIRECTIONS.down]: { x2: '0', y2: '1' },
  [FADE_DIRECTIONS.across]: { x2: '1', y2: '0' },
} as const satisfies Record<FadeDirection, FadeEnd>

type FadeProps = {
  /** The gradient's id, unique on the page. */
  id: string
  direction: FadeDirection
  /** The ground's opacity where the fade starts and where it ends. */
  from: number
  to: number
  height: number
  /** A number of points, or a share of the hero such as "100%". */
  width: number | string
  style: StyleProp<ViewStyle>
}

/** The ground's colour faded from one opacity to another over a box: the hero's foot, or the photo's seam. */
function Fade({ id, direction, from, to, height, width, style }: FadeProps) {
  const { colors } = useWrenTheme()
  return (
    <Svg height={height} style={style} width={width}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" {...FADE_ENDS[direction]}>
          <Stop offset="0" stopColor={colors.bg} stopOpacity={from} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={to} />
        </LinearGradient>
      </Defs>
      <Rect fill={`url(#${id})`} height="100%" width="100%" />
    </Svg>
  )
}

type HeroPhotoProps = {
  photo: Cover
  height: number
  /** The photo's own width: the whole hero, or its shape kept to the end on a wide one. */
  width: number
  isWide: boolean
  onLoad: (event: ImageLoadEvent) => void
}

/** The artist's photo, over a blurred and veiled copy of itself on a wide hero, the two met by a seam. */
function HeroPhoto({ photo, height, width, isWide, onLoad }: HeroPhotoProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const seam = width * SEAM_SHARE
  return (
    <>
      {isWide && (
        <>
          <Image
            accessibilityIgnoresInvertColors
            blurRadius={DETAIL_SIZES.heroBlur}
            resizeMode="cover"
            source={photo}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.bg, opacity: BACKDROP_VEIL },
            ]}
          />
        </>
      )}
      <Image
        accessibilityIgnoresInvertColors
        onLoad={onLoad}
        resizeMode="cover"
        source={photo}
        style={[styles.photo, { width: isWide ? width : '100%' }]}
      />
      {isWide && (
        <Fade
          direction={FADE_DIRECTIONS.across}
          from={BACKDROP_VEIL}
          height={height}
          id={SEAM_ID}
          style={[styles.seam, { right: width - seam }]}
          to={0}
          width={seam}
        />
      )}
    </>
  )
}

/** Play, Shuffle and Follow at the hero's foot, as a tablet holds them. */
export function HeroActions({ children }: HeroActionsProps) {
  const styles = useStyles()
  return <View style={styles.actions}>{children}</View>
}

/**
 * An artist's page's head, full bleed: their photo (kept to the end over a blurred copy of itself
 * when the hero is wide), or a shape with their initial, fading to the ground, back and More on
 * dark circles over it, and their name in Young Serif with their counts.
 */
export function ArtistHero({ name, meta, photo, onMore, actions, sides, about }: ArtistHeroProps) {
  const styles = useStyles()
  const { top } = useSafeAreaInsets()
  const height = HERO_HEIGHTS[useFormFactor()]
  const fade = height * FADE_SHARE
  const [heroWidth, setHeroWidth] = useState(0)
  const [aspect, setAspect] = useState(PHOTO_RATIO)
  const photoWidth = photoWidthOf({ heroWidth, height, aspect })
  const isWide = heroWidth > photoWidth
  const aboutWidth = heroWidth - photoWidth - sides - SPACE.s4
  const shouldTell =
    photo !== null && about !== null && hasAbout(about) && aboutWidth >= DETAIL_SIZES.heroAboutRoom
  // The bar sits this far down; the about starts the same gap under it.
  const barTop = top + SPACE.s2
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setHeroWidth(nativeEvent.layout.width)
  const onLoad = ({ nativeEvent }: ImageLoadEvent) =>
    setAspect(nativeEvent.source.width / nativeEvent.source.height)
  return (
    <View onLayout={onLayout} style={[styles.hero, { height }]}>
      {photo === null && (
        <View style={[styles.shape, { right: height * SHAPE.right, top: height * SHAPE.top }]}>
          <ArtistAvatar name={name} picture={null} size={height * SHAPE.size} />
        </View>
      )}
      {photo !== null && (
        <HeroPhoto
          height={height}
          isWide={isWide}
          onLoad={onLoad}
          photo={photo}
          width={photoWidth}
        />
      )}
      <Fade
        direction={FADE_DIRECTIONS.down}
        from={0}
        height={fade}
        id={FADE_ID}
        style={[StyleSheet.absoluteFill, { top: height - fade }]}
        to={1}
        width="100%"
      />
      <View style={[styles.bar, { top: barTop }]}>
        <BackButton onPicture={ON_PICTURE} />
        <IconButton
          color={ON_PICTURE.ink}
          fill={ON_PICTURE.veil}
          icon={ICONS.more}
          label={DETAIL_COPY.more}
          onPress={onMore}
        />
      </View>
      {shouldTell && (
        <About
          about={about}
          left={sides}
          top={barTop + SIZE.touchTarget + SPACE.s2}
          width={aboutWidth}
        />
      )}
      <View style={[styles.foot, { left: sides, right: sides }]}>
        <View style={styles.names}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.name}>
            {name}
          </Text>
          {meta !== '' && <Text style={styles.meta}>{meta}</Text>}
        </View>
        {actions}
      </View>
    </View>
  )
}
