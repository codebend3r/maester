import { type SkipStep, TOUCH_HOLD_RATE, type TouchSide } from '@raven/core'
import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native'

import { PLAYER_COPY } from '@/layouts/playerKit'
import { Text } from '@/layouts/Text'
import { useMarkFade } from '@/layouts/useMarkFade'
import { SIZES } from '@/theme/appTheme'
import { pictureStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

const MARK_ICON = 24

/** Where a mark stands over the picture: at the side a skip was tapped on, or along the top for a hold. */
const MARK_PLACES = { left: 'left', right: 'right', top: 'top' } as const

type MarkPlace = (typeof MARK_PLACES)[keyof typeof MARK_PLACES]

type SideLook = {
  icon: IconName
  place: MarkPlace
  /** What a skip that way is called aloud, by its seconds. */
  skipped: (seconds: number) => string
  /** What a finger held on that side is called aloud, by its speed. */
  held: (rate: number) => string
}

/** Each side of the picture as its marks show it: back on the left, forward on the right. */
const SIDE_LOOKS = {
  [-1]: {
    icon: APP_ICONS.rewind,
    place: MARK_PLACES.left,
    skipped: PLAYER_COPY.back,
    held: PLAYER_COPY.holdBack,
  },
  [1]: {
    icon: APP_ICONS.forward,
    place: MARK_PLACES.right,
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

/** A mark on the player's glass over the picture, out of the finger's way. Said aloud as it appears. */
const PictureMark = ({ icon, text, label, place, isFading, sides }: PictureMarkProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => theme.overPicture.text)
  const { opacity, isGone } = useMarkFade({ isFading })
  const slots = {
    [MARK_PLACES.left]: styles.left,
    [MARK_PLACES.right]: styles.right,
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

/** A skip's seconds at the side it went, standing a moment and fading. Key it by the skip, so each starts afresh. */
export const SkipMark = ({ step, sides }: SkipMarkProps) => {
  const look = SIDE_LOOKS[step.direction]
  return (
    <PictureMark
      icon={look.icon}
      isFading
      label={look.skipped(step.seconds)}
      place={look.place}
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

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    left: { alignItems: 'flex-start', justifyContent: 'center' },
    right: { alignItems: 'flex-end', justifyContent: 'center' },
    top: { alignItems: 'center', justifyContent: 'flex-start' },
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
