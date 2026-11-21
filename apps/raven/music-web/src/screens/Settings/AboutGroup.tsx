import { SETTINGS_COPY } from '@raven/wren'
import { useState } from 'react'
import { version } from '#package'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { FactRow } from '@/ui/FactRow/FactRow'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow/NavigationRow'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Settings/AboutGroup.module.scss'

/** The fonts' copyright and their licence, the Open Font License's notice. */
function LicenseNotices() {
  return (
    <div className={styles.notices}>
      {SETTINGS_COPY.fonts.map(({ name, copyright }) => (
        <section className={styles.font} key={name}>
          <h3 className={styles.name}>{name}</h3>
          <p className={styles.notice}>{copyright}</p>
        </section>
      ))}
      <p className={styles.notice}>{SETTINGS_COPY.fontLicense}</p>
    </div>
  )
}

/** Which Wren this is, and the licences of what it is set in. */
export function AboutGroup() {
  const [isShowingLicenses, setIsShowingLicenses] = useState(false)
  return (
    <>
      <GroupedList heading={SETTINGS_COPY.about}>
        <FactRow icon={ICONS.info} label={SETTINGS_COPY.version} value={version} />
        <NavigationRow
          label={SETTINGS_COPY.licenses}
          onPress={() => setIsShowingLicenses(true)}
          variant={NAVIGATION_ROW_VARIANTS.settings}
        />
      </GroupedList>
      <BottomSheet
        head={{ title: SETTINGS_COPY.licenses, subtitle: SETTINGS_COPY.licensesNote }}
        isOpen={isShowingLicenses}
        onClose={() => setIsShowingLicenses(false)}
      >
        <LicenseNotices />
      </BottomSheet>
    </>
  )
}
