import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { tvFieldStyles } from '@/layouts/Form.focus'
import { formStyles } from '@/layouts/formStyles'
import {
  CLEAR_SEARCH,
  type SearchFieldProps,
  type SearchKit,
  type SearchLayoutProps,
} from '@/layouts/searchKit'
import { COLOURS, SIZES } from '@/theme/appTheme'

/** What a field does on focus by default: nothing more than its own ring. */
const NOTHING = (): void => undefined

/**
 * A search box the remote selects, which opens the platform's own keyboard. It reports each
 * key as it is typed, and the box searches once typing pauses or the keyboard sends it.
 * Leaving the keyboard with Menu cancels the edit: the native field goes back to what it held
 * but reports no change, so the box takes the text it ends editing with, as sign-in's does.
 */
const SearchField = ({
  search,
  label,
  isPreferred = false,
  onFocused = NOTHING,
}: SearchFieldProps) => {
  const [isFocused, setFocused] = useState(false)
  return (
    <View style={styles.box}>
      <View
        style={[
          formStyles.input,
          tvFieldStyles.frame,
          styles.frame,
          isFocused && formStyles.focused,
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          hasTVPreferredFocus={isPreferred}
          onBlur={() => setFocused(false)}
          onChangeText={search.setText}
          onEndEditing={({ nativeEvent }) => search.setText(nativeEvent.text)}
          onFocus={() => {
            setFocused(true)
            onFocused()
          }}
          onSubmitEditing={() => search.searchNow()}
          placeholder={label}
          placeholderTextColor={COLOURS.muted}
          returnKeyType="search"
          style={tvFieldStyles.input}
          value={search.text}
        />
      </View>
      {search.text !== '' && (
        <Pressable
          accessibilityLabel={CLEAR_SEARCH.label}
          accessibilityRole="button"
          onPress={() => search.searchFor('')}
          style={({ focused }) => [styles.clear, focused && formStyles.focused]}
        >
          <Text style={styles.clearText}>{CLEAR_SEARCH.text}</Text>
        </Pressable>
      )}
    </View>
  )
}

/**
 * The search screen on a TV: the title and the field at the top, and the results below as
 * rows the remote moves along. The remote starts on the field, and only as the screen opens:
 * once the field has had the focus, results that arrive leave it where the viewer put it.
 */
const SearchLayout = ({ title, label, search, notice, children }: SearchLayoutProps) => {
  const [isOpening, setOpening] = useState(true)
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <SearchField
          isPreferred={isOpening}
          label={label}
          onFocused={() => setOpening(false)}
          search={search}
        />
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      </View>
      {children}
    </ScrollView>
  )
}

/** Search on a TV. */
export const focusSearch: SearchKit = { SearchField, SearchLayout }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  page: { gap: SIZES.space4, paddingVertical: SIZES.space6 },
  header: { gap: SIZES.space3, paddingHorizontal: SIZES.space8 },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  notice: { color: COLOURS.muted, fontSize: SIZES.textLg },
  box: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
  frame: { width: SIZES.measure },
  clear: {
    minWidth: SIZES.controlLarge,
    minHeight: SIZES.controlLarge,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: COLOURS.quiet,
    backgroundColor: COLOURS.quiet,
  },
  clearText: { color: COLOURS.text, fontSize: SIZES.textLg, fontWeight: '600' },
})
