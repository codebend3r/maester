import { SETTINGS_COPY } from '@raven/wren'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { wrenVersion } from '@/about/version'
import { FactRow, SettingsGroup } from '@/screens/settings/parts'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { ListRow } from '@/ui/ListRow'
import { Sheet } from '@/ui/Sheet'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  font: { gap: SPACE.s1 },
  name: { ...TYPE.row, color: colors.text },
  notice: { ...TYPE.meta, color: colors.text2 },
}))

/** Which Wren this is, and the licences of what it is set in. */
export function AboutGroup() {
  const styles = useStyles()
  const [isShowingLicenses, setIsShowingLicenses] = useState(false)
  return (
    <SettingsGroup heading={SETTINGS_COPY.about}>
      <FactRow label={SETTINGS_COPY.version} value={SETTINGS_COPY.versionOf(wrenVersion)} />
      <ListRow
        icon={ICONS.info}
        onPress={() => setIsShowingLicenses(true)}
        canOpen
        title={SETTINGS_COPY.licenses}
      />
      <Sheet
        isOpen={isShowingLicenses}
        line={SETTINGS_COPY.licensesNote}
        onClose={() => setIsShowingLicenses(false)}
        title={SETTINGS_COPY.licenses}
      >
        {SETTINGS_COPY.fonts.map(({ name, copyright }) => (
          <View key={name} style={styles.font}>
            <Text accessibilityRole="header" style={styles.name}>
              {name}
            </Text>
            <Text style={styles.notice}>{copyright}</Text>
          </View>
        ))}
        <Text style={styles.notice}>{SETTINGS_COPY.fontLicense}</Text>
      </Sheet>
    </SettingsGroup>
  )
}
