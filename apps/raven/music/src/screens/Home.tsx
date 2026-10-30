import { StyleSheet, Text, View } from 'react-native'

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})

/** Wren's first screen, until sign-in and the tabs arrive. */
export function Home() {
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header">Wren</Text>
    </View>
  )
}
