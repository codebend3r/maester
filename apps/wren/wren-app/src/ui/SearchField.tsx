import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { KIT_COPY, WREN_ICONS } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  box: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.surface2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.focusRing,
    flex: 1,
    flexDirection: 'row',
    gap: SPACE.s2,
    height: SIZE.searchField,
    paddingLeft: SPACE.s3,
  },
  compact: { borderRadius: RADIUS.item, height: SIZE.searchFieldCompact },
  focused: { borderColor: colors.accentText },
  input: { ...TYPE.input, color: colors.text, flex: 1, height: '100%' },
  cancel: { justifyContent: 'center', minHeight: SIZE.touchTarget },
  cancelLabel: { ...TYPE.rowTitle, color: colors.accentText },
}))

type SearchFieldProps = {
  value: string
  onChangeText: (text: string) => void
  /** Enter: search at once, without waiting for the typing to pause. */
  onSubmit?: () => void
  /** Cancel: leave the search. Shown while the field holds the focus. */
  onCancel?: () => void
  /** The field inside a list, 42 tall rather than 46. */
  isCompact?: boolean
  placeholder?: string
  label?: string
}

/**
 * A search box: a field with its magnifier, and while it holds the focus a clear button and a
 * Cancel link. It only holds what is typed: a screen pairs it with `useSearch`, so a search runs
 * once typing pauses, never on each keystroke.
 */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  onCancel,
  isCompact = false,
  placeholder = KIT_COPY.searchPlaceholder,
  label = KIT_COPY.search,
}: SearchFieldProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const [isFocused, setIsFocused] = useState(false)
  return (
    <View style={styles.row}>
      <View style={[styles.box, isCompact && styles.compact, isFocused && styles.focused]}>
        <WrenIcon color={colors.text3} name={WREN_ICONS.search} size={SIZE.navIcon} />
        <TextInput
          accessibilityLabel={label}
          accessibilityRole="search"
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={() => setIsFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setIsFocused(true)}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={colors.text3}
          returnKeyType="search"
          selectionColor={colors.accentText}
          style={styles.input}
          value={value}
        />
        {isFocused && value !== '' && (
          <IconButton
            color={colors.text3}
            icon={WREN_ICONS.close}
            label={KIT_COPY.clearSearch}
            onPress={() => onChangeText('')}
            size={SIZE.smallButton}
          />
        )}
      </View>
      {isFocused && onCancel !== undefined && (
        <Pressable
          accessibilityRole="button"
          hitSlop={SPACE.s2}
          onPress={onCancel}
          style={pressedStyleOf({ style: styles.cancel })}
        >
          <Text style={styles.cancelLabel}>{KIT_COPY.cancel}</Text>
        </Pressable>
      )}
    </View>
  )
}
