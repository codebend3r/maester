import type { ComponentType, ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { SETTINGS_COPY } from '@raven/wren'
import { AboutGroup } from '@/screens/settings/AboutGroup'
import { AccountCard } from '@/screens/settings/AccountCard'
import { AppearanceGroup } from '@/screens/settings/AppearanceGroup'
import { DownloadsGroup, RemoveAllDownloads } from '@/screens/settings/DownloadsGroup'
import { ServerGroup } from '@/screens/settings/ServerGroup'
import { usePageInsets } from '@/shell/useShell'
import { themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { PageHeader } from '@/ui/PageHeader'
import { useWren } from '@/useWren'

const useStyles = themedStyles(() => ({
  page: { gap: SPACE.s6 },
  column: { gap: SPACE.s6 },
  columns: { alignItems: 'flex-start', flexDirection: 'row', gap: SPACE.s8 },
  half: { flex: 1, gap: SPACE.s6, minWidth: 0 },
}))

/** Settings' groups, each drawn once, which a layout arranges. */
type SettingsGroups = {
  account: ReactNode
  server: ReactNode
  appearance: ReactNode
  downloads: ReactNode
  removeAll: ReactNode
  about: ReactNode
}

type SettingsLayoutProps = { groups: SettingsGroups }

/** The phone stacks the groups in one column, the downloads before About. */
function OneColumn({ groups }: SettingsLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.column}>
      {groups.account}
      {groups.server}
      {groups.appearance}
      {groups.downloads}
      {groups.removeAll}
      {groups.about}
    </View>
  )
}

/** The tablet sets the downloads beside the account, the server, the appearance and About. */
function TwoColumns({ groups }: SettingsLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.columns}>
      <View style={styles.half}>
        {groups.account}
        {groups.server}
        {groups.appearance}
        {groups.about}
      </View>
      <View style={styles.half}>
        {groups.downloads}
        {groups.removeAll}
      </View>
    </View>
  )
}

/** Where a screen sets the groups: one column on a phone, two on a tablet. */
const LAYOUTS = {
  [FORM_FACTORS.phone]: OneColumn,
  [FORM_FACTORS.tablet]: TwoColumns,
} as const satisfies Record<FormFactor, ComponentType<SettingsLayoutProps>>

/**
 * The account and Sign out, the server and whether it answers, the appearance, the downloads'
 * quality, limit and use, Remove all downloads, and which Wren this is.
 */
export function Settings() {
  const styles = useStyles()
  const insets = usePageInsets()
  const session = useWren()
  const Layout = LAYOUTS[useFormFactor()]
  const groups = {
    account: <AccountCard />,
    server: session !== null && <ServerGroup session={session} />,
    appearance: <AppearanceGroup />,
    downloads: <DownloadsGroup />,
    removeAll: <RemoveAllDownloads serverName={session?.server.name ?? null} />,
    about: <AboutGroup />,
  }
  return (
    <ScrollView contentContainerStyle={[styles.page, insets]}>
      <PageHeader title={SETTINGS_COPY.title} />
      <Layout groups={groups} />
    </ScrollView>
  )
}
