import type { ApiClient } from '@raven/core'
import { useState } from 'react'

import type { AccountSessionStore } from '@/account/accountSession'
import {
  FINISH_OUTCOMES,
  SIGN_IN_STEPS,
  type SignInStep,
  finishSignIn,
} from '@/account/signInSteps'
import { AUTH_OUTCOMES } from '@/account/supabaseAuth'
import { useSubmit } from '@/account/useSubmit'
import type { ActiveServerStore } from '@/servers/activeServerStore'
import type { AppServer } from '@/servers/serverList'

/** The words a sign-in says, each app its own. */
type SignInCopy = {
  unreachable: string
  badAccount: string
  full: string
  notAdded: string
}

type SignInFlowForProps = {
  account: Pick<AccountSessionStore, 'getState'>
  servers: Pick<ActiveServerStore, 'getState'>
  apiOf: (server: AppServer) => ApiClient
  /** The one server the account signs in to, `RAVEN_SERVER`. */
  server: AppServer
}

type UseSignInFlowProps = {
  copy: SignInCopy
  initial: { email: string; password: string }
  /** Where a finished sign-in goes, and the tickets-off Continue. */
  onDone: () => void
}

type SubmitAccountProps = { password?: string }

/**
 * The hook that runs sign-in's steps, as both apps do: the account's email and password, and
 * nothing more; no client ever asks for a PIN. Each screen keeps its fields, its layout and its copy.
 * Made per app at module scope, since a store handed to a hook at render reads to the hooks
 * rule as a hook used as a value.
 */
export const signInFlowFor = ({
  account,
  servers,
  apiOf,
  server: ravenServer,
}: SignInFlowForProps) => {
  const useSignInFlow = ({ copy, initial, onDone }: UseSignInFlowProps) => {
    const [step, setStep] = useState<SignInStep>({ kind: SIGN_IN_STEPS.account })
    const [email, setEmail] = useState(initial.email)
    const [password, setPassword] = useState(initial.password)
    const { isBusy, error, setError, run } = useSubmit({ unreachable: copy.unreachable })

    const finish = async (server: AppServer) => {
      const outcome = await finishSignIn({ servers, server, api: apiOf(server) })
      switch (outcome) {
        case FINISH_OUTCOMES.done:
          onDone()
          return
        case FINISH_OUTCOMES.ticketsOff:
          setStep({ kind: SIGN_IN_STEPS.ticketsOff })
          return
        case FINISH_OUTCOMES.full:
          setError(copy.full)
          return
        case FINISH_OUTCOMES.notAdded:
          setError(copy.notAdded)
          return
        default: {
          const unknown: never = outcome
          return unknown
        }
      }
    }

    /** `password` is the one just typed, when the field's submit comes before its state. */
    const submitAccount = ({ password: typed = password }: SubmitAccountProps = {}) => {
      const trimmed = email.trim()
      if (trimmed === '' || typed === '') {
        setError(copy.badAccount)
        return
      }
      run(async () => {
        const outcome = await account.getState().signIn({ email: trimmed, password: typed })
        if (outcome.kind === AUTH_OUTCOMES.unreachable) {
          setError(copy.unreachable)
          return
        }
        if (outcome.kind === AUTH_OUTCOMES.refused) {
          setError(outcome.message)
          return
        }
        setPassword('')
        await finish(ravenServer)
      })
    }

    return {
      step,
      email,
      setEmail,
      password,
      setPassword,
      isBusy,
      error,
      submitAccount,
    }
  }
  return useSignInFlow
}
