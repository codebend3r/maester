import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TouchBack } from '@/layouts/TouchBack'
import { formStyles } from '@/layouts/formStyles'
import {
  CLEAR_SEARCH,
  type SearchFieldProps,
  type SearchKit,
  type SearchLayoutProps,
} from '@/layouts/searchKit'
import { COLOURS, SIZES } from '@/theme/appTheme'

/**
 * A search box under the thumb: the keyboard's Search key searches at once, and while it
 * holds text a button beside it empties it, which asks for nothing.
 */
const SearchField = ({ search, label }: SearchFieldProps) => (
  <View style={[formStyles.input, styles.box]}>
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={search.setText}
      onSubmitEditing={() => search.searchNow()}
      placeholder={label}
      placeholderTextColor={COLOURS.muted}
      returnKeyType="search"
      style={styles.input}
      value={search.text}
    />
    {search.text !== '' && (
      <Pressable
        accessibilityLabel={CLEAR_SEARCH.label}
        accessibilityRole="button"
        hitSlop={SIZES.space1}
        onPress={() => search.searchFor('')}
        style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
      >
        <Text style={styles.clearText}>{CLEAR_SEARCH.text}</Text>
      </Pressable>
    )}
  </View>
)

/**
 * The search screen on a phone or tablet: the way back, the title and the field held at the
 * top, and the results scrolled below them, clear of the side insets of a phone held sideways.
 * A drag puts the keyboard away, and a card under it still takes the first tap.
 */
const SearchLayout = ({ title, label, search, notice, onBack, children }: SearchLayoutProps) => {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  // Held sideways, the screen is short: the title and the field share a row, leaving the
  // results the room.
  const isWide = window.width > window.height
  const sides = { paddingLeft: insets.left, paddingRight: insets.right }
  return (
    <View style={styles.ground}>
      <View style={[styles.top, sides, { paddingTop: insets.top + SIZES.space2 }]}>
        <TouchBack onPress={onBack} />
        <View style={isWide && styles.wideRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={isWide ? styles.wideField : styles.field}>
            <SearchField label={label} search={search} />
          </View>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.results,
          sides,
          { paddingBottom: insets.bottom + SIZES.space5 },
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={styles.ground}
      >
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
        {children}
      </ScrollView>
    </View>
  )
}

/** Search on a phone or tablet. */
export const touchSearch: SearchKit = { SearchField, SearchLayout }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  top: { gap: SIZES.space2, paddingBottom: SIZES.space3, marginHorizontal: SIZES.space3 },
  title: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  wideRow: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
  wideField: { flex: 1 },
  field: { paddingTop: SIZES.space2 },
  // No wider than a line of reading on a tablet.
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: SIZES.measure,
    paddingHorizontal: 0,
  },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    color: COLOURS.text,
    fontSize: SIZES.text,
    paddingHorizontal: SIZES.space2,
  },
  clear: {
    minWidth: SIZES.fieldHeight,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: COLOURS.muted, fontSize: SIZES.textLg },
  pressed: { opacity: 0.6 },
  results: { gap: SIZES.space4, paddingTop: SIZES.space2 },
  notice: { color: COLOURS.muted, fontSize: SIZES.text, paddingHorizontal: SIZES.space3 },
})
