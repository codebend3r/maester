import { RAVEN_SERVER, SIGN_IN_ERRORS } from '@raven/native/headless'
import { useRouter } from 'expo-router'

import { WREN_ROUTES } from '@/routes'
import { SIGN_IN_FRAMES } from '@/screens/signIn/SignInFrame'
import { SIGN_IN_VIEWS } from '@/screens/signIn/StepForms'
import { useSignInFlow } from '@/screens/signIn/useSignInFlow'
import { useActiveServer } from '@/stores/activeServer'
import { useServerName } from '@/stores/wrenPrefs'
import { useFormFactor } from '@/theme/wrenTheme'

type ActiveServerState = ReturnType<typeof useActiveServer.getState>

/** The active server's configured name, or raven's before one is pinned. */
const serverNameOf = ({ servers, activeId }: ActiveServerState): string =>
  servers.find((server) => server.id === activeId)?.name ?? RAVEN_SERVER.name

/**
 * The first launch: the raven account's email and password, over `@raven/native`'s
 * `signInFlowFor`. It never asks for a PIN. A phone draws it in one column, a tablet beside
 * the brand's Night half.
 */
export function SignIn() {
  const router = useRouter()
  const listedName = useActiveServer(serverNameOf)
  const serverName = useServerName({ fallback: listedName })
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
