import { WREN_ICONS, type WrenIconName } from '@raven/wren'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  button: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s2,
    minHeight: SIZE.touchTarget,
  },
  options: { paddingVertical: SPACE.s2 },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.navRow,
    paddingHorizontal: SPACE.s3,
  },
  optionLabel: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  chosen: { color: colors.accentText },
}))

// A red link on a phone; an outlined button on a tablet.
const useButtonStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: {},
  [FORM_FACTORS.tablet]: {
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    paddingHorizontal: SPACE.s4,
  },
}))

const useLabelStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: { ...TYPE.rowTitle, color: colors.accentText },
  [FORM_FACTORS.tablet]: { ...TYPE.rowTitle, color: colors.text },
}))

/** One of the choices a button offers, as it is kept and as it is called. */
type ChoiceOption<Choice extends string> = { value: Choice; label: string }

type ChoiceButtonProps<Choice extends string> = {
  /** The sheet's title: "Sort by". */
  title: string
  icon: WrenIconName
  /** The button's spoken name, from the choice in use's word: "Sort by, Title". */
  spokenLabelOf: (label: string) => string
  options: readonly ChoiceOption<Choice>[]
  chosen: Choice
  onChoose: (choice: Choice) => void
}

/**
 * A list's choice in use (its sort, its cover size), as a red link on a phone and an outlined
 * button on a tablet, showing the choice's word. A press opens a sheet of the choices, the one
 * in use checked.
 */
export function ChoiceButton<Choice extends string>({
  title,
  icon,
  spokenLabelOf,
  options,
  chosen,
  onChoose,
}: ChoiceButtonProps<Choice>) {
  const styles = useStyles()
  const buttonStyles = useButtonStyles()
  const labelStyles = useLabelStyles()
  const formFactor = useFormFactor()
  const { colors } = useWrenTheme()
  const [isOpen, setIsOpen] = useState(false)
  const label = options.find(({ value }) => value === chosen)?.label ?? ''
  const labelStyle = labelStyles[formFactor]
  const choose = (next: Choice) => {
    onChoose(next)
    setIsOpen(false)
  }
  return (
    <>
      <Pressable
        accessibilityLabel={spokenLabelOf(label)}
        accessibilityRole="button"
        hitSlop={SPACE.s2}
        onPress={() => setIsOpen(true)}
        style={pressedStyleOf({ style: [styles.button, buttonStyles[formFactor]] })}
      >
        <WrenIcon color={labelStyle.color} name={icon} size={SIZE.smallIcon} />
        <Text style={labelStyle}>{label}</Text>
      </Pressable>
      <BottomSheet head={{ title }} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === chosen }}
              key={option.value}
              onPress={() => choose(option.value)}
              style={pressedStyleOf({ style: styles.option })}
            >
              <Text style={[styles.optionLabel, option.value === chosen && styles.chosen]}>
                {option.label}
              </Text>
              {option.value === chosen && (
                <WrenIcon color={colors.accentText} name={WREN_ICONS.check} size={SIZE.smallIcon} />
              )}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </>
  )
}
