import type { ReactNode } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { DETAIL_COPY } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { BackButton } from '@/screens/detail/BackButton'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import {
  COLORS,
  DETAIL_SIZES,
  SPACE,
  TYPE,
  FORM_FACTORS,
  type FormFactor,
} from '@/theme/wrenTokens'
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

// What sits on the picture is drawn the same in both themes: light icons on a dark veil.
const ON_PICTURE = { veil: COLORS.dark.scrim, ink: COLORS.dark.text } as const

const FADE_ID = 'artist-hero-fade'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  hero: { backgroundColor: colors.surface, overflow: 'hidden' },
  shape: { position: 'absolute' },
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
}

type HeroActionsProps = { children: ReactNode }

/** Play, Shuffle and Follow at the hero's foot, as a tablet holds them. */
export function HeroActions({ children }: HeroActionsProps) {
  const styles = useStyles()
  return <View style={styles.actions}>{children}</View>
}

/**
 * An artist's page's head, full bleed: their photo, or a shape with their initial, fading to the
 * ground, back and More on dark circles over it, and their name in Young Serif with their counts.
 */
export function ArtistHero({ name, meta, photo, onMore, actions, sides }: ArtistHeroProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { top } = useSafeAreaInsets()
  const height = HERO_HEIGHTS[useFormFactor()]
  const fade = height * FADE_SHARE
  return (
    <View style={[styles.hero, { height }]}>
      {photo === null && (
        <View style={[styles.shape, { right: height * SHAPE.right, top: height * SHAPE.top }]}>
          <ArtistAvatar name={name} picture={null} size={height * SHAPE.size} />
        </View>
      )}
      {photo !== null && (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={photo}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Svg height={fade} style={[StyleSheet.absoluteFill, { top: height - fade }]} width="100%">
        <Defs>
          <LinearGradient id={FADE_ID} x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity="0" />
            <Stop offset="1" stopColor={colors.bg} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect fill={`url(#${FADE_ID})`} height="100%" width="100%" />
      </Svg>
      <View style={[styles.bar, { top: top + SPACE.s2 }]}>
        <BackButton onPicture={ON_PICTURE} />
        <IconButton
          color={ON_PICTURE.ink}
          fill={ON_PICTURE.veil}
          icon={ICONS.more}
          label={DETAIL_COPY.more}
          onPress={onMore}
        />
      </View>
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
