import { useRouter } from 'expo-router'
import { StyleSheet, Text } from 'react-native'

import { BUTTON_TONES, Form, FormButton } from '@/layouts'
import { COLOURS, SIZES } from '@/theme/appTheme'

const COPY = {
  title: 'Play',
  notYet: 'Playing in the app is on its way. Until then, play this on the web.',
  back: 'Back',
} as const

/**
 * `/play/[mediaId]`: where Play and Resume go. The app's player is still to come, so for now
 * this says so and leads back to the page the viewer came from.
 */
export const Play = () => {
  const router = useRouter()
  return (
    <Form title={COPY.title}>
      <Text style={styles.line}>{COPY.notYet}</Text>
      <FormButton label={COPY.back} onPress={() => router.back()} tone={BUTTON_TONES.primary} />
    </Form>
  )
}

const styles = StyleSheet.create({
  line: { color: COLOURS.muted, fontSize: SIZES.text },
})
