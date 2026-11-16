import { type SkipStep, TOUCH_HOLD_RATE, type TouchSide } from '@raven/core'
import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native'

import { PLAYER_COPY } from '@/layouts/playerKit'
import { Text } from '@/layouts/Text'
import { MARK_TIMINGS, useMarkFade } from '@/layouts/useMarkFade'
import { SIZES } from '@/theme/appTheme'
import { pictureStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

const MARK_ICON = 24

/** Where a mark stands: in the middle for a skip, of the picture or of an album's cover, or along the top for a hold. */
const MARK_PLACES = { centre: 'centre', top: 'top' } as const

type MarkPlace = (typeof MARK_PLACES)[keyof typeof MARK_PLACES]

type SideLook = {
  icon: IconName
  /** What a skip that way is called aloud, by its seconds. */
  skipped: (seconds: number) => string
  /** What a finger held on that side is called aloud, by its speed. */
  held: (rate: number) => string
}

/** Each side of the picture as its marks show it: back on the left, forward on the right. */
const SIDE_LOOKS = {
  [-1]: {
    icon: APP_ICONS.rewind,
    skipped: PLAYER_COPY.back,
    held: PLAYER_COPY.holdBack,
  },
  [1]: {
    icon: APP_ICONS.forward,
    skipped: PLAYER_COPY.forward,
    held: PLAYER_COPY.holdForward,
  },
} as const satisfies Record<TouchSide, SideLook>

type PictureMarkProps = {
  icon: IconName
  text: string
  label: string
  place: MarkPlace
  isFading: boolean
  /** The safe area's padding, so the mark keeps clear of the screen's edges. */
  sides: ViewStyle
}

/** A mark on the player's glass over the picture or a cover. Said aloud as it appears. */
const PictureMark = ({ icon, text, label, place, isFading, sides }: PictureMarkProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  const { opacity, isGone } = useMarkFade({ isFading, timing: MARK_TIMINGS.mark })
  const slots = {
    [MARK_PLACES.centre]: styles.centre,
    [MARK_PLACES.top]: styles.top,
  } as const satisfies Record<MarkPlace, ViewStyle>
  return (
    !isGone && (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, sides, slots[place]]}>
        <Animated.View
          accessibilityLabel={label}
          accessibilityLiveRegion="polite"
          accessible
          style={[styles.mark, { opacity }]}
        >
          <Icon colour={colour} name={icon} size={MARK_ICON} />
          <Text style={styles.text}>{text}</Text>
        </Animated.View>
      </View>
    )
  )
}

type SkipMarkProps = Pick<PictureMarkProps, 'sides'> & { step: SkipStep }

/**
 * How far a skip went, "10s" beside its way's icon, in the middle of what it stands over (the
 * picture, or Now Playing's cover), standing a moment and fading. Key it by the skip, so each
 * starts afresh.
 */
export const SkipMark = ({ step, sides }: SkipMarkProps) => {
  const look = SIDE_LOOKS[step.direction]
  return (
    <PictureMark
      icon={look.icon}
      isFading
      label={look.skipped(step.seconds)}
      place={MARK_PLACES.centre}
      sides={sides}
      text={PLAYER_COPY.seconds(step.seconds)}
    />
  )
}

type HoldMarkProps = Pick<PictureMarkProps, 'sides'> & { side: TouchSide }

/** The speed a held finger plays at, along the top for as long as it is held. */
export const HoldMark = ({ side, sides }: HoldMarkProps) => (
  <PictureMark
    icon={SIDE_LOOKS[side].icon}
    isFading={false}
    label={SIDE_LOOKS[side].held(TOUCH_HOLD_RATE)}
    place={MARK_PLACES.top}
    sides={sides}
    text={PLAYER_COPY.rate(TOUCH_HOLD_RATE)}
  />
)

/** How strongly the wash over a tapped half shows at its brightest, 0 to 1. */
const AREA_WASH = 0.16

type TapAreaFlashProps = { side: TouchSide }

/**
 * The half of the picture a double tap landed on, washed in the on-picture colour for a second
 * and fading, so the viewer sees where each way's taps go. It says nothing aloud: the skip's
 * mark does. Key it by the tap, so each starts afresh.
 */
export const TapAreaFlash = ({ side }: TapAreaFlashProps) => {
  const styles = useStyles()
  const { opacity, isGone } = useMarkFade({ isFading: true, timing: MARK_TIMINGS.area })
  // The left half for back, the right for forward.
  const halves = {
    [-1]: styles.leftHalf,
    [1]: styles.rightHalf,
  } as const satisfies Record<TouchSide, ViewStyle>
  return (
    !isGone && (
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.area, halves[side], { opacity }]}
      >
        <View style={styles.wash} />
      </Animated.View>
    )
  )
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    centre: { alignItems: 'center', justifyContent: 'center' },
    top: { alignItems: 'center', justifyContent: 'flex-start' },
    area: { position: 'absolute', top: 0, bottom: 0, width: '50%' },
    leftHalf: { left: 0 },
    rightHalf: { right: 0 },
    wash: { flex: 1, backgroundColor: colours.text, opacity: AREA_WASH },
    // The player's glass, as the buttons wear it.
    mark: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space2,
      paddingVertical: SIZES.space2,
      paddingHorizontal: SIZES.space4,
      borderRadius: SIZES.controlLarge,
      backgroundColor: colours.quiet,
    },
    text: {
      color: colours.text,
      fontSize: SIZES.text,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  }),
)
