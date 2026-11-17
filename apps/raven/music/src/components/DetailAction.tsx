import type { ComponentType, ReactNode } from 'react'
import { Pressable, Text } from 'react-native'

import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'

/** How an action is drawn: its icon over its word, or its icon alone in an outlined circle. */
export const ACTION_SHAPES = { labelled: 'labelled', circle: 'circle' } as const

type ActionShape = (typeof ACTION_SHAPES)[keyof typeof ACTION_SHAPES]

/** A phone shows an action's word under its icon; a tablet draws it in a circle. */
const SHAPE_OF_FORM = {
  [FORM_FACTORS.phone]: ACTION_SHAPES.labelled,
  [FORM_FACTORS.tablet]: ACTION_SHAPES.circle,
} as const satisfies Record<FormFactor, ActionShape>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  labelled: {
    alignItems: 'center',
    gap: SPACE.s1,
    justifyContent: 'center',
    minHeight: SIZE.touchTarget,
    minWidth: SIZE.touchTarget,
    paddingHorizontal: SPACE.s2,
    paddingVertical: SPACE.s1,
  },
  label: { ...TYPE.actionLabel, color: colors.text2 },
  on: { color: colors.accentText },
  circle: {
    alignItems: 'center',
    borderColor: colors.line2,
    borderRadius: RADIUS.pill,
    borderWidth: SIZE.hairline,
    height: SIZE.buttonLarge,
    justifyContent: 'center',
    width: SIZE.buttonLarge,
  },
}))

type DetailActionProps = {
  /** The word under the icon on a phone: "Download", "Like", "2 of 3". */
  label: string
  /** What it is called aloud, when that says more than the word: "Downloading 2 of 3". */
  spoken?: string
  /** The icon, or a progress ring in its place. */
  glyph: ReactNode
  onPress: () => void
  /** Shown but not pressable, and said as dimmed: a download on its way. */
  isDisabled?: boolean
  /** A switch's state, for Like and Follow; left out for a plain button. */
  isOn?: boolean
  /** Its shape whatever the form factor: an artist's Follow is always a circle. */
  shape?: ActionShape
}

type ActionViewProps = Omit<DetailActionProps, 'shape'> & { spokenLabel: string }

const roleOf = (isOn: boolean | undefined) => (isOn === undefined ? 'button' : 'switch')

const stateOf = ({ isOn, isDisabled = false }: Pick<DetailActionProps, 'isOn' | 'isDisabled'>) =>
  isOn === undefined ? { disabled: isDisabled } : { checked: isOn, disabled: isDisabled }

/** A phone's action under Play and Shuffle: its icon over its word. */
function LabelledAction({ label, spokenLabel, glyph, onPress, isDisabled, isOn }: ActionViewProps) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={spokenLabel}
      accessibilityRole={roleOf(isOn)}
      accessibilityState={stateOf({ isOn, isDisabled })}
      disabled={isDisabled}
      onPress={onPress}
      style={pressedStyleOf({ style: styles.labelled, isDisabled })}
    >
      {glyph}
      <Text numberOfLines={1} style={[styles.label, !!isOn && styles.on]}>
        {label}
      </Text>
    </Pressable>
  )
}

/** A tablet's action beside the others: its icon in an outlined circle, its word said aloud. */
function CircleAction({ spokenLabel, glyph, onPress, isDisabled, isOn }: ActionViewProps) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={spokenLabel}
      accessibilityRole={roleOf(isOn)}
      accessibilityState={stateOf({ isOn, isDisabled })}
      disabled={isDisabled}
      onPress={onPress}
      style={pressedStyleOf({ style: styles.circle, isDisabled })}
    >
      {glyph}
    </Pressable>
  )
}

const ACTION_VIEWS = {
  [ACTION_SHAPES.labelled]: LabelledAction,
  [ACTION_SHAPES.circle]: CircleAction,
} as const satisfies Record<ActionShape, ComponentType<ActionViewProps>>

/**
 * One of an album's, an artist's or a playlist's actions beside Play and Shuffle: Download, Like,
 * Follow, Queue, and on a tablet More. A phone shows its word under the icon; a tablet draws it
 * in a circle.
 */
export function DetailAction({ spoken, shape, ...props }: DetailActionProps) {
  const formShape = SHAPE_OF_FORM[useFormFactor()]
  const Action = ACTION_VIEWS[shape ?? formShape]
  return <Action {...props} spokenLabel={spoken ?? props.label} />
}
