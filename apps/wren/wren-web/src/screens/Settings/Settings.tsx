import { SETTINGS_COPY } from '@raven/wren'
import { AboutGroup } from '@/screens/Settings/AboutGroup'
import { AccountCard } from '@/screens/Settings/AccountCard'
import { AppearanceGroup } from '@/screens/Settings/AppearanceGroup'
import { LibraryGroup } from '@/screens/Settings/LibraryGroup'
import { ServerGroup } from '@/screens/Settings/ServerGroup'
import { Page } from '@/shell/Page/Page'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import styles from '@/screens/Settings/Settings.module.scss'

/**
 * `/settings`: the account and Sign out, the server with its address and whether it answers, the
 * music library worn, the appearance, and which Wren this is. One column on the narrow layout;
 * two on the wide one, as the apps' tablet sets its groups, with the appearance and About where
 * the apps' downloads stand.
 */
export function Settings() {
  return (
    <Page>
      <PageHeader title={SETTINGS_COPY.title} />
      <div className={styles.columns}>
        <div className={styles.first}>
          <AccountCard />
          <ServerGroup />
          <LibraryGroup />
        </div>
        <div className={styles.second}>
          <AppearanceGroup />
          <AboutGroup />
        </div>
      </div>
    </Page>
  )
}
