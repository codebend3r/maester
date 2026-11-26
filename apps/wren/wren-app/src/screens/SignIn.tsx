import { SIGN_IN_ERRORS } from '@raven/native/headless'
import { useRouter } from 'expo-router'

import { useActiveServerName, useSignInFlow } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { SIGN_IN_FRAMES } from '@/screens/signIn/SignInFrame'
import { SIGN_IN_VIEWS } from '@/screens/signIn/StepForms'
import { useFormFactor } from '@/theme/wrenTheme'

/**
 * The first launch: the raven account's email and password, over `@raven/native`'s
 * `signInFlowFor`. It never asks for a PIN. A phone draws it in one column, a tablet beside
 * the brand's Night half.
 */
export function SignIn() {
  const router = useRouter()
  const serverName = useActiveServerName()
  const openTabs = () => router.replace(WREN_ROUTES.home)
  const flow = useSignInFlow({
    initial: { email: '', password: '' },
    onDone: openTabs,
  })
  const Frame = SIGN_IN_FRAMES[useFormFactor()]
  const StepForm = SIGN_IN_VIEWS[flow.step.kind]
  return (
    <Frame
      server={{
        name: serverName,
        isDown: (flow.error?.kind ?? null) === SIGN_IN_ERRORS.unreachable,
      }}
    >
      <StepForm flow={flow} onDone={openTabs} />
    </Frame>
  )
}
