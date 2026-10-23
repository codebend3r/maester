import { StyleSheet, Text, View } from 'react-native'

import { COLOURS, SIZES } from '@/theme/appTheme'

/** `/item/[id]`: where a card goes. A stand-in until the item page is built. */
export const Item = () => (
  <View style={styles.screen}>
    <Text style={styles.line}>This title's page is on its way.</Text>
  </View>
)

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOURS.ground,
    padding: SIZES.space5,
  },
  line: { color: COLOURS.muted, fontSize: SIZES.textLg },
})
