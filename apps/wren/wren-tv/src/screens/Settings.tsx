import { SETTINGS_COPY } from '@raven/wren'
import { useWren } from '@raven/wren-native'
import { ScrollView, View } from 'react-native'

import { AboutGroup } from '@/screens/settings/AboutGroup'
import { AccountGroup } from '@/screens/settings/AccountGroup'
import { AppearanceGroup } from '@/screens/settings/AppearanceGroup'
import { LibraryGroup } from '@/screens/settings/LibraryGroup'
import { ServerGroup } from '@/screens/settings/ServerGroup'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { PageHeader } from '@/ui/Headers'
import { usePageStyles } from '@/ui/pageStyles'

const useStyles = themedStyles(() => ({
  page: { gap: SPACE.s6, padding: SPACE.gutter },
  columns: { alignItems: 'flex-start', flexDirection: 'row', gap: SPACE.s8 },
  half: { flex: 1, gap: SPACE.s6 },
}))

/**
 * The account and Sign out, the server with its address and whether it answers, the music
 * library worn, the appearance and which Wren this is, in the tablet's two columns. A TV keeps no
 * downloads and has no mobile network, so it has neither group.
 */
export function Settings() {
  const page = usePageStyles()
  const styles = useStyles()
  const session = useWren()
  return (
    <ScrollView contentContainerStyle={styles.page} style={page.ground}>
      <PageHeader title={SETTINGS_COPY.title} />
      <View style={styles.columns}>
        <View style={styles.half}>
          <AccountGroup />
          {session !== null && (
            <>
              <ServerGroup session={session} />
              <LibraryGroup session={session} />
            </>
          )}
        </View>
        <View style={styles.half}>
          <AppearanceGroup />
          <AboutGroup />
        </View>
      </View>
    </ScrollView>
  )
}
