import { SIGN_IN_ERRORS } from '@raven/core'
import { useNavigate } from 'react-router-dom'
import { WREN_ROUTES } from '@/routes'
import { AccountForm } from '@/screens/SignIn/AccountForm'
import { SIGN_IN_FRAMES } from '@/screens/SignIn/SignInFrame'
import { useSignInFlow } from '@/screens/SignIn/useSignInFlow'
import { useFormFactor } from '@/theme/formFactor'

/**
 * `/sign-in`: the raven account's email and password, and nothing more. The narrow layout draws
 * it in one column under the mark, the wide one beside the brand's Night half. Once in, the
 * listener lands on Home.
 */
export function SignIn() {
  const navigate = useNavigate()
  const flow = useSignInFlow({ onDone: () => navigate(WREN_ROUTES.home, { replace: true }) })
  const Frame = SIGN_IN_FRAMES[useFormFactor()]
  return (
    <Frame isServerDown={(flow.error?.kind ?? null) === SIGN_IN_ERRORS.unreachable}>
      <AccountForm flow={flow} />
    </Frame>
  )
}
