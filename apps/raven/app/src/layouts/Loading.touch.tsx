import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LoadingKit, LoadingProps } from '@/layouts/loadingKit'
import { LoadingMark } from '@/layouts/LoadingMark'
import { TouchBack } from '@/layouts/TouchBack'
import { SIZES } from '@/theme/appTheme'

/** The loading screen under the thumb, with the way back at the top while a page opens. */
const Loading = ({ label, onBack }: LoadingProps) => {
  const insets = useSafeAreaInsets()
  return (
    <View style={styles.screen}>
      <LoadingMark gap={SIZES.space4} label={label} markWidth={SIZES.space6 * 2} />
      {onBack !== undefined && (
        <View
          style={[styles.back, { paddingTop: insets.top, paddingLeft: insets.left + SIZES.space3 }]}
        >
          <TouchBack onPress={onBack} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { position: 'absolute', top: 0, left: 0 },
})

export const touchLoading: LoadingKit = { Loading }
