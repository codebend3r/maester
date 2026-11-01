import { ScrollView, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { useScreenFocusScope } from '@/layouts/focus'
import {
  CLEAR_SEARCH,
  type SearchFieldProps,
  type SearchKit,
  type SearchLayoutProps,
} from '@/layouts/searchKit'
import { NOTHING_ON_FOCUS, PlateButton, TvTextField } from '@/layouts/tvControls'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/**
 * A search box the remote selects, which opens the platform's own keyboard. It searches once
 * typing pauses or the keyboard sends it, and a clear button beside it empties it.
 */
const SearchField = ({
  search,
  label,
  isPreferred = false,
  onFocused = NOTHING_ON_FOCUS,
}: SearchFieldProps) => {
  const styles = useStyles()
  return (
    <View style={styles.box}>
      <TvTextField
        frameStyle={styles.frame}
        isPreferred={isPreferred}
        label={label}
        onChangeText={search.setText}
        onFocused={onFocused}
        onSubmit={search.searchFor}
        placeholder={label}
        returnKeyType="search"
        value={search.text}
      />
      {search.text !== '' && (
        <PlateButton
          label={CLEAR_SEARCH.label}
          onPress={() => search.searchFor('')}
          accessibilityRole="button"
          text={CLEAR_SEARCH.text}
        />
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
  const { isOpening, settle } = useScreenFocusScope()
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
      <View style={styles.header}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <SearchField isPreferred={isOpening} label={label} onFocused={settle} search={search} />
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      </View>
      {children}
    </ScrollView>
  )
}

/** Search on a TV. */
export const focusSearch: SearchKit = { SearchField, SearchLayout }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: TV_SIZES.space4, paddingVertical: TV_SIZES.space6 },
    header: { gap: TV_SIZES.space3, paddingHorizontal: TV_GUTTER },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    notice: { color: colours.muted, fontSize: TV_SIZES.textLg },
    box: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space2 },
    frame: { width: TV_SIZES.measure },
  }),
)
