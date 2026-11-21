import { Pressable, Text, View } from 'react-native'

import { SETTINGS_COPY, STORAGE_COPY } from '@raven/wren'
import { STORAGE_LIMITS_GB, useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

type StorageLimitGb = (typeof STORAGE_LIMITS_GB)[number]

/** A storage limit as Settings says it: "Off", or "5 GB". */
export const storageLimitLabelOf = (gigabytes: StorageLimitGb): string =>
  gigabytes === null ? STORAGE_COPY.off : STORAGE_COPY.gigabytes(gigabytes)

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  list: { paddingVertical: SPACE.s2 },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.buttonLarge,
    paddingHorizontal: SPACE.s3,
  },
  label: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
}))

type StorageLimitSheetProps = { isOpen: boolean; onClose: () => void }

/** The storage limits to pick from, the one kept checked; picking one keeps it and closes. */
export function StorageLimitSheet({ isOpen, onClose }: StorageLimitSheetProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const storageLimitGb = useWrenPrefs((state) => state.storageLimitGb)
  const change = useWrenPrefs((state) => state.change)
  return (
    <BottomSheet head={{ title: SETTINGS_COPY.storageLimit }} isOpen={isOpen} onClose={onClose}>
      <View
        accessibilityLabel={SETTINGS_COPY.storageLimit}
        accessibilityRole="radiogroup"
        style={styles.list}
      >
        {STORAGE_LIMITS_GB.map((gigabytes) => {
          const isSelected = gigabytes === storageLimitGb
          const label = storageLimitLabelOf(gigabytes)
          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={label}
              onPress={() => {
                change({ storageLimitGb: gigabytes })
                onClose()
              }}
              style={pressedStyleOf({ style: styles.option })}
            >
              <Text style={styles.label}>{label}</Text>
              {isSelected && (
                <WrenIcon color={colors.accentText} name={ICONS.check} size={SIZE.icon} />
              )}
            </Pressable>
          )
        })}
      </View>
    </BottomSheet>
  )
}
