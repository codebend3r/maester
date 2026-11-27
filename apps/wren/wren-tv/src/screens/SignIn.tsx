import { SIGN_IN_ERRORS } from '@raven/native/headless'
import { SIGN_IN_COPY, STATUS_COPY } from '@raven/wren'
import { useRouter } from 'expo-router'
import { useActiveServerName, useSignInFlow } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { Text, View } from 'react-native'

import { ScanPanel } from '@/screens/signIn/ScanPanel'
import { SIGN_IN_VIEWS } from '@/screens/signIn/StepForms'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { WrenLockup } from '@/ui/WrenLockup'

const useStyles = themedStyles(({ colors }) => ({
  ground: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    flexDirection: 'row',
    gap: SPACE.s8,
    justifyContent: 'center',
    padding: SPACE.gutter,
  },
  brand: { flex: 1, gap: SPACE.s4, maxWidth: '45%' },
  title: { ...TYPE.hero, color: colors.text },
  note: { ...TYPE.body, color: colors.text2 },
  family: { ...TYPE.meta, color: colors.text3 },
  server: { ...TYPE.meta, color: colors.text2 },
  down: { color: colors.accentText },
}))

/**
 * The first launch: the raven account's email and password, over `@raven/native`'s
 * `signInFlowFor`, the phone's own flow, with the server it signs in to and whether it answered.
 * It never asks for a PIN. The TV lays the brand and the welcome beside the form, as the tablet
 * does, and under the welcome a code a phone scans to sign the TV in with nothing typed.
 */
export function SignIn() {
  const styles = useStyles()
  const router = useRouter()
  const openTabs = () => router.replace(WREN_ROUTES.home)
  const flow = useSignInFlow({
    initial: { email: '', password: '' },
    onDone: openTabs,
    deviceName: SIGN_IN_COPY.tvName,
  })
  const StepForm = SIGN_IN_VIEWS[flow.step.kind]
  const serverName = useActiveServerName()
  const isDown = (flow.error?.kind ?? null) === SIGN_IN_ERRORS.unreachable
  const status = isDown ? STATUS_COPY.unreachable(serverName) : STATUS_COPY.connected(serverName)
  return (
    <View style={styles.ground}>
      <View style={styles.brand}>
        <WrenLockup />
        <Text accessibilityRole="header" style={styles.title}>
          {SIGN_IN_COPY.welcome}
        </Text>
        <Text style={styles.note}>{SIGN_IN_COPY.note}</Text>
        {flow.link !== null && <ScanPanel link={flow.link} onRenew={flow.renewLink} />}
        <Text style={[styles.server, isDown && styles.down]}>{status}</Text>
        <Text style={styles.family}>{SIGN_IN_COPY.family}</Text>
      </View>
      <StepForm flow={flow} onDone={openTabs} />
    </View>
  )
}
