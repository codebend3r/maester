import type { CollectionSearch } from '@raven/wren-native'
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { PageHeader } from '@/ui/Headers'
import { TextField } from '@/ui/TextField'

const useStyles = themedStyles(() => ({
  header: { gap: SPACE.s4, paddingBottom: SPACE.s4 },
  tools: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s3 },
}))

type CollectionHeaderProps = {
  title: string
  /** How many the list holds, "1,980 albums", or null until it is known. */
  count: string | null
  search?: CollectionSearch
  /** The page's controls after the search: Sort, Cover size, Play and Shuffle, New playlist. */
  children?: ReactNode
}

/**
 * A category page's head: its title and count, then its search box and its controls in one row,
 * which the remote reaches first. Back on the remote returns to Library.
 */
export function CollectionHeader({ title, count, search, children }: CollectionHeaderProps) {
  const styles = useStyles()
  return (
    <View style={styles.header}>
      <PageHeader line={count} title={title} />
      {(search !== undefined || children !== undefined) && (
        <View style={styles.tools}>
          {search !== undefined && (
            <TextField
              hasPreferredFocus
              label={search.placeholder}
              onChangeText={search.onChangeText}
              placeholder={search.placeholder}
              returnKeyType="search"
              value={search.value}
            />
          )}
          {children}
        </View>
      )}
    </View>
  )
}
