import { Icon } from '@raven/native'
import { type Search, useSearch } from '@raven/ui/headless'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { Text } from '@/layouts/Text'
import { CLEAR_SEARCH } from '@/layouts/searchKit'
import { SEARCH_EVERY_LIBRARY } from '@/layouts/shelfKit'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { useSearchFocus } from '@/stores/searchFocus'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { DISPLAY_FONT } from '@/theme/fonts'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

type TouchSearchBarProps = {
  /** The box's state, from headless `useSearch`, so a page that searches as it is typed waits for a pause. */
  search: Search
  /** What it searches, shown while it is empty and said aloud: "Search every library". */
  label: string
  /** Whether the page opens with the keyboard up on the field. */
  isPreferred?: boolean
  /** Runs the search for what was typed, from the button or the keyboard's Search key. */
  onRun: () => void
}

/**
 * The search box every touch page that searches wears, the web's site search: an underline
 * rather than a box, its words in the display face, the search icon at its start, which runs
 * the search, and while it holds text a button that empties it. The keyboard's Search key runs
 * it too, and either at once: nothing is asked while typing. Focused, the underline darkens
 * and the header fades the page's top under it (`SearchFade`).
 */
export const TouchSearchBar = ({
  search,
  label,
  isPreferred = false,
  onRun,
}: TouchSearchBarProps) => {
  const styles = useStyles()
  const colours = useTheme((theme) => theme.palette)
  const [isFocused, setFocused] = useState(false)
  const focus = (isNow: boolean) => {
    setFocused(isNow)
    useSearchFocus.setState({ isFocused: isNow })
  }
  // A field that leaves the screen while focused takes the fade with it.
  useEffect(() => () => useSearchFocus.setState({ isFocused: false }), [])
  return (
    <View style={[styles.bar, isFocused && styles.focused]}>
      <Pressable
        accessibilityLabel={TOUCH_NAV_COPY.runSearch}
        accessibilityRole="button"
        hitSlop={SIZES.space1}
        onPress={onRun}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon colour={colours.muted} name={APP_ICONS.search} size={SIZES.textXl} />
      </Pressable>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- a search screen opens to be typed in, as iOS's own do
        autoFocus={isPreferred}
        autoCorrect={false}
        onBlur={() => focus(false)}
        onChangeText={search.setText}
        onFocus={() => focus(true)}
        onSubmitEditing={onRun}
        placeholder={label}
        placeholderTextColor={colours.muted}
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
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.clear}>{CLEAR_SEARCH.text}</Text>
        </Pressable>
      )}
    </View>
  )
}

type SearchEveryLibraryProps = {
  /** Runs the search through every library for what was typed; empty when nothing was. */
  onSearch: (query: string) => void
}

/**
 * The search through every library, from Home's header and the side menu: it hands what was
 * typed to the page that searches, and empties as that page opens.
 */
export const SearchEveryLibrary = ({ onSearch }: SearchEveryLibraryProps) => {
  const search = useSearch()
  return (
    <TouchSearchBar
      label={SEARCH_EVERY_LIBRARY.label}
      onRun={() => {
        onSearch(search.text.trim())
        search.searchFor('')
      }}
      search={search}
    />
  )
}

/** The underline's width at rest, and focused, when it thickens as the web's ring does. */
const UNDERLINE = { rest: 1, focused: 2 } as const

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: SIZES.fieldHeight,
      borderBottomWidth: UNDERLINE.rest,
      borderBottomColor: colours.line,
      backgroundColor: 'transparent',
    },
    focused: { borderBottomWidth: UNDERLINE.focused, borderBottomColor: colours.text },
    input: {
      flex: 1,
      alignSelf: 'stretch',
      color: colours.text,
      fontFamily: DISPLAY_FONT,
      fontSize: SIZES.textXl,
      paddingRight: SIZES.space1,
    },
    action: {
      minWidth: SIZES.fieldHeight,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
    },
    clear: { color: colours.muted, fontSize: SIZES.textLg },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
