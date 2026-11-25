import { useState } from 'react'
import { Text, View } from 'react-native'

import { SETTINGS_COPY } from '@raven/wren'
import { wrenVersion } from '@/about/version'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { FactRow } from '@/ui/FactRow'
import { GroupedList } from '@/ui/GroupedList'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  notices: { gap: SPACE.s4, padding: SPACE.s3 },
  font: { gap: SPACE.s1 },
  name: { ...TYPE.rowStrong, color: colors.text },
  notice: { ...TYPE.meta, color: colors.text2 },
}))

/** The fonts' copyright and their licence, the Open Font License's notice. */
function LicenseNotices() {
  const styles = useStyles()
  return (
    <View style={styles.notices}>
      {SETTINGS_COPY.fonts.map(({ name, copyright }) => (
        <View key={name} style={styles.font}>
          <Text accessibilityRole="header" style={styles.name}>
            {name}
          </Text>
          <Text style={styles.notice}>{copyright}</Text>
        </View>
      ))}
      <Text style={styles.notice}>{SETTINGS_COPY.fontLicense}</Text>
    </View>
  )
}

/** Which Wren this is, and the licences of what it is set in. */
export function AboutGroup() {
  const [isShowingLicenses, setIsShowingLicenses] = useState(false)
  return (
    <>
      <GroupedList heading={SETTINGS_COPY.about}>
        <FactRow
          icon={ICONS.info}
          label={SETTINGS_COPY.version}
          value={SETTINGS_COPY.versionOf(wrenVersion)}
        />
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
