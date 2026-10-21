import { type ComponentRef, type Ref, useRef, useState } from 'react'
import {
  type AccessibilityRole,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native'

import { useFocusOnMount } from '@/layouts/focus'
import { useTvFormStyles } from '@/layouts/formStyles'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** What a TV control does on focus unless told more: nothing beyond its own ring or growth. */
export const NOTHING_ON_FOCUS = (): void => undefined

/** The round end of tvOS's focused field plate: half the field's height. */
const PLATE_END = TV_SIZES.controlLarge / 2

/**
 * A TV text field's frame and the input inside it. tvOS draws a focused text field as its own
 * raised plate with round ends. The input runs past the frame by those ends, which the frame
 * clips, so what shows has the frame's corners, the radius every other control has. Android's
 * text input pads itself top and bottom, which would stand it taller than the plate buttons
 * beside it, so the input sets its own.
 */
const useFieldStyles = themedStyles((colours) =>
  StyleSheet.create({
    frame: { minHeight: TV_SIZES.controlLarge, overflow: 'hidden', paddingHorizontal: 0 },
    input: {
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      minHeight: TV_SIZES.controlLarge,
      paddingVertical: 0,
      marginHorizontal: -PLATE_END,
      paddingHorizontal: PLATE_END + TV_SIZES.space2,
    },
  }),
)

/**
 * A text field the remote selects, which opens the platform's own keyboard. The keyboard reports
 * the text back as it is typed; leaving it with Menu cancels the edit, and the native field goes
 * back to what it held, but no change is reported, so the field takes the text it ends editing
 * with as the truth. `isPreferred` gives it the remote as it is drawn, once, until it has had
 * the focus, so a screen never opens with nothing focused and never pulls the remote back.
 * Android's text input has no preferred focus, and its own `focus()` opens the keyboard, so the
 * frame asks, and the focus goes on to the input inside it.
 */
export const TvTextField = ({
  label,
  value,
  onChangeText,
  onSubmit,
  isPreferred,
  onFocused = NOTHING_ON_FOCUS,
  frameStyle,
  ...input
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  onSubmit: (text: string) => void
  isPreferred: boolean
  onFocused?: () => void
  frameStyle?: StyleProp<ViewStyle>
} & Pick<
  TextInputProps,
  'placeholder' | 'placeholderTextColor' | 'keyboardType' | 'returnKeyType' | 'secureTextEntry'
>) => {
  const [isFocused, setFocused] = useState(false)
  const [hasHadFocus, setHadFocus] = useState(false)
  const frame = useRef<ComponentRef<typeof View>>(null)
  const tvFormStyles = useTvFormStyles()
  const tvFieldStyles = useFieldStyles()
  const muted = useTheme((theme) => theme.palette.muted)
  useFocusOnMount({ view: frame, isAsked: isPreferred })
  return (
    <View
      ref={frame}
      collapsable={false}
      style={[
        tvFormStyles.input,
        tvFieldStyles.frame,
        frameStyle,
        isFocused && tvFormStyles.focused,
      ]}
    >
      <TextInput
        placeholderTextColor={muted}
        {...input}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={isPreferred && !hasHadFocus}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onEndEditing={({ nativeEvent }) => onChangeText(nativeEvent.text)}
        onFocus={() => {
          setFocused(true)
          setHadFocus(true)
          onFocused()
        }}
        onSubmitEditing={({ nativeEvent }) => onSubmit(nativeEvent.text)}
        style={tvFieldStyles.input}
        value={value}
      />
    </View>
  )
}

/**
 * A TV control's plate: the quiet fill, at least as wide as it is tall, whose edge turns to
 * the text colour while it has the focus. Over the video the fill is translucent glass, so the
 * edge stays clear until then rather than lay a second coat of it round the plate.
 */
export const usePlateStyles = themedStyles((colours) =>
  StyleSheet.create({
    plate: {
      minWidth: TV_SIZES.controlLarge,
      minHeight: TV_SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      backgroundColor: colours.quiet,
    },
    focused: { borderColor: colours.text },
    label: { color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  }),
)

/**
 * A plain button on a plate, the remote's to press: `text` is what it shows, `label` is said,
 * `isPreferred` asks the remote's focus for it as it appears, `onFocused` hears each time it
 * gets the focus, and `isOverPicture` gives it the player's dark glass in every theme. `ref`
 * holds its view, for a button that takes the focus back itself (`useOpenerFocus`).
 */
export const PlateButton = ({
  ref,
  text,
  label,
  accessibilityRole,
  isPreferred = false,
  isOverPicture = false,
  onFocused = NOTHING_ON_FOCUS,
  onPress,
}: {
  ref?: Ref<ComponentRef<typeof Pressable>>
  text: string
  label: string
  accessibilityRole: AccessibilityRole
  isPreferred?: boolean
  isOverPicture?: boolean
  onFocused?: () => void
  onPress: () => void
}) => {
  const plateStyles = usePlateStyles({ isOverPicture })
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole={accessibilityRole}
      hasTVPreferredFocus={isPreferred}
      onFocus={onFocused}
      onPress={onPress}
      style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
    >
      <Text style={plateStyles.label}>{text}</Text>
    </Pressable>
  )
}
