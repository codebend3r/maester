import { type ComponentRef, useRef } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { useFocusOnMount } from '@/layouts/focus'
import type { FormButtonProps } from '@/layouts/formKit'
import { useToneStyles, useTvFormStyles } from '@/layouts/formStyles'
import { Text } from '@/layouts/Text'
import { TV_SIZES } from '@/theme/tvSizes'

/** The TV form's button, which sign-in's code panel wears too; the step's first takes the remote. */
export const FormButton = ({
  label,
  onPress,
  tone,
  isDisabled = false,
  isFirst = false,
}: FormButtonProps) => {
  const formStyles = useTvFormStyles()
  const toneStyles = useToneStyles()
  const button = useRef<ComponentRef<typeof Pressable>>(null)
  useFocusOnMount({ view: button, isAsked: isFirst })
  return (
    <Pressable
      ref={button}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      hasTVPreferredFocus={isFirst}
      onPress={onPress}
      style={({ focused }) => [
        formStyles.button,
        styles.button,
        toneStyles[tone].button,
        focused && formStyles.focused,
        isDisabled && formStyles.disabled,
      ]}
    >
      <Text style={[formStyles.buttonText, styles.buttonText, toneStyles[tone].label]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: TV_SIZES.controlLarge, borderWidth: TV_SIZES.tvFocusRing },
  buttonText: { fontSize: TV_SIZES.textLg },
})
