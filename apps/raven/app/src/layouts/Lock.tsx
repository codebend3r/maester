import { Icon } from '@raven/native'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { BUTTON_TONES, type FormKit } from '@/layouts/formKit'
import { focusForm } from '@/layouts/Form.focus'
import { touchForm } from '@/layouts/Form.touch'
import { LOCKED_LIBRARY_COPY, PIN_PAD_COPY } from '@/layouts/copy'
import {
  type LockKit,
  type LockedNoticeProps,
  PAD_FIRST,
  PAD_ROWS,
  PAD_ZERO,
  type PadDigit,
  type PinPadProps,
} from '@/layouts/lockKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { BODY_FONT } from '@/theme/fonts'
import { OPACITIES, SIZES, type Sizes } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

type LockKitForProps = {
  sizes: Sizes
  /** How thick the focus ring is drawn: twice as thick on a TV, read from the sofa. */
  ring: number
  form: Pick<FormKit, 'FormButton'>
}

/**
 * The PIN lock's pieces at one platform's scale, the web's `LockedLibrary` and `PinPadDialog`:
 * the lock, its message and the owner's Unlock, and the pad of big round keys, three across as
 * a phone's keypad, 1 to 9 and then Backspace, 0 and Unlock, which a finger presses and the
 * remote moves through alike.
 */
const lockKitFor = ({ sizes, ring, form: { FormButton } }: LockKitForProps): LockKit => {
  const keySize = sizes.controlLarge + sizes.space2
  const useStyles = themedStyles((colours) =>
    StyleSheet.create({
      locked: {
        alignItems: 'center',
        gap: sizes.space3,
        paddingVertical: sizes.space5,
        width: '100%',
      },
      lockMark: {
        alignItems: 'center',
        justifyContent: 'center',
        width: keySize,
        height: keySize,
        borderRadius: keySize / 2,
        backgroundColor: colours.raised,
      },
      message: { color: colours.text, fontSize: sizes.textLg, textAlign: 'center' },
      backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
      // The web's `--color-scrim` is a translucent black React Native's tokens cannot carry.
      shade: { ...StyleSheet.absoluteFill, backgroundColor: colours.deep, opacity: 0.85 },
      panel: {
        alignItems: 'stretch',
        gap: sizes.space3,
        padding: sizes.space4,
        borderRadius: sizes.radiusLg,
        borderWidth: 1,
        borderColor: colours.line,
        backgroundColor: colours.raised,
        maxWidth: sizes.measure,
      },
      title: { color: colours.text, fontSize: sizes.textXl, textAlign: 'center' },
      hint: { color: colours.muted, fontSize: sizes.text, textAlign: 'center' },
      entered: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: sizes.fieldHeight,
        paddingHorizontal: sizes.space2,
        borderRadius: sizes.radiusLg,
        backgroundColor: colours.deep,
      },
      dots: { color: colours.text, fontSize: sizes.textLg, letterSpacing: sizes.space0 },
      empty: { color: colours.muted, fontSize: sizes.textSm },
      pad: { alignSelf: 'center', gap: sizes.space2 },
      padRow: { flexDirection: 'row', gap: sizes.space4 },
      key: {
        alignItems: 'center',
        justifyContent: 'center',
        width: keySize,
        height: keySize,
        borderRadius: keySize / 2,
        borderWidth: ring,
        borderColor: colours.line,
        backgroundColor: colours.quiet,
      },
      enter: { borderColor: colours.accent, backgroundColor: colours.accent },
      keyText: {
        color: colours.text,
        fontFamily: BODY_FONT,
        fontSize: sizes.textLg,
        fontWeight: '500',
        fontVariant: ['lining-nums', 'tabular-nums'],
      },
      focused: { borderColor: colours.text },
      pressed: { opacity: OPACITIES.pressed },
      disabled: { opacity: OPACITIES.disabled },
      error: {
        color: colours.error,
        fontSize: sizes.textSm,
        paddingHorizontal: sizes.space3,
        paddingVertical: sizes.space2,
        borderLeftWidth: ring,
        borderLeftColor: colours.error,
        backgroundColor: colours.deep,
      },
    }),
  )

  const LockedNotice = ({ name, canUnlock, onUnlock }: LockedNoticeProps) => {
    const styles = useStyles()
    const text = useTheme((theme) => theme.palette.text)
    return (
      <View accessibilityLabel={LOCKED_LIBRARY_COPY.locked} style={styles.locked}>
        <View style={styles.lockMark}>
          <Icon colour={text} name="lock" size={sizes.textXl} />
        </View>
        <Text style={styles.message}>{LOCKED_LIBRARY_COPY.isLocked(name)}</Text>
        {canUnlock && (
          <FormButton
            isFirst
            label={LOCKED_LIBRARY_COPY.unlock}
            onPress={onUnlock}
            tone={BUTTON_TONES.primary}
          />
        )}
      </View>
    )
  }

  type PadKeyProps = {
    label: string
    onPress: () => void
    isDisabled?: boolean
    isEnter?: boolean
    isFirst?: boolean
    children: ReactNode
  }

  const PadKey = ({
    label,
    onPress,
    isDisabled = false,
    isEnter = false,
    isFirst = false,
    children,
  }: PadKeyProps) => {
    const styles = useStyles()
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        hasTVPreferredFocus={isFirst}
        onPress={onPress}
        style={({ pressed, focused }) => [
          styles.key,
          isEnter && styles.enter,
          pressed && styles.pressed,
          focused && styles.focused,
          isDisabled && styles.disabled,
        ]}
      >
        {children}
      </Pressable>
    )
  }

  type DigitKeyProps = { digit: PadDigit; onDigit: (digit: PadDigit) => void }

  const DigitKey = ({ digit, onDigit }: DigitKeyProps) => {
    const styles = useStyles()
    return (
      <PadKey isFirst={digit === PAD_FIRST} label={digit} onPress={() => onDigit(digit)}>
        <Text style={styles.keyText}>{digit}</Text>
      </PadKey>
    )
  }

  const PinPad = ({
    isOpen,
    pin,
    error,
    isPending,
    onDigit,
    onBackspace,
    onUnlock,
    onCancel,
  }: PinPadProps) => {
    const styles = useStyles()
    const palette = useTheme((theme) => theme.palette)
    const isEmpty = pin === ''
    const canUnlock = !isEmpty && !isPending
    return (
      <Modal transparent animationType="none" visible={isOpen} onRequestClose={onCancel}>
        <View style={styles.backdrop}>
          <View style={styles.shade} />
          <ScrollView contentContainerStyle={styles.backdrop} keyboardShouldPersistTaps="handled">
            <View accessibilityViewIsModal style={styles.panel}>
              <Text accessibilityRole="header" style={styles.title} variant={TEXT_VARIANTS.display}>
                {PIN_PAD_COPY.title}
              </Text>
              <Text style={styles.hint}>{PIN_PAD_COPY.hint}</Text>
              <View
                accessibilityLabel={PIN_PAD_COPY.entered(pin.length)}
                accessibilityLiveRegion="polite"
                style={styles.entered}
              >
                <Text style={isEmpty ? styles.empty : styles.dots}>
                  {isEmpty ? PIN_PAD_COPY.empty : PIN_PAD_COPY.dot.repeat(pin.length)}
                </Text>
              </View>
              <View accessibilityLabel={PIN_PAD_COPY.pad} style={styles.pad}>
                {PAD_ROWS.map((row) => (
                  <View key={row.join('')} style={styles.padRow}>
                    {row.map((digit) => (
                      <DigitKey key={digit} digit={digit} onDigit={onDigit} />
                    ))}
                  </View>
                ))}
                <View style={styles.padRow}>
                  <PadKey isDisabled={isEmpty} label={PIN_PAD_COPY.backspace} onPress={onBackspace}>
                    <Icon colour={palette.text} name="backspace" size={sizes.textXl} />
                  </PadKey>
                  <DigitKey digit={PAD_ZERO} onDigit={onDigit} />
                  <PadKey
                    isDisabled={!canUnlock}
                    isEnter
                    label={PIN_PAD_COPY.unlock}
                    onPress={onUnlock}
                  >
                    <Icon colour={palette.onAccent} name="unlock" size={sizes.textXl} />
                  </PadKey>
                </View>
              </View>
              {error !== null && (
                <Text
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={styles.error}
                >
                  {error}
                </Text>
              )}
              <FormButton
                label={PIN_PAD_COPY.cancel}
                onPress={onCancel}
                tone={BUTTON_TONES.ghost}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    )
  }

  return { LockedNotice, PinPad }
}

/** The PIN lock under the thumb, at the shared scale. */
export const touchLock: LockKit = lockKitFor({
  sizes: SIZES,
  ring: SIZES.focusRing,
  form: touchForm,
})

/** The PIN lock on a TV, sized to its screen and driven by the remote. */
export const focusLock: LockKit = lockKitFor({
  sizes: TV_SIZES,
  ring: TV_SIZES.tvFocusRing,
  form: focusForm,
})
