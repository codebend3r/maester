import type { ApiClient } from '@raven/core'
import { useState } from 'react'

import type { AccountSessionStore } from '@/account/accountSession'
import {
  FINISH_OUTCOMES,
  SIGN_IN_STEPS,
  type SecretStep,
  type SignInStep,
  finishSignIn,
  stepAfterAccount,
  stepAfterSecret,
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
  pin: string
  pinPrompt: string
  adminPassword: string
  adminPrompt: string
}

/** What a secret step asks for: its prompt, its field's label, and whether it takes digits. */
export type SecretPrompt = { prompt: string; label: string; isNumeric: boolean }

type SignInFlowForProps = {
  account: Pick<AccountSessionStore, 'getState'>
  servers: Pick<ActiveServerStore, 'getState'>
  apiOf: (server: AppServer) => ApiClient
  /** The one server the account signs in to, `RAVEN_SERVER`. */
  server: AppServer
  /** An end to end build names an accountless fixture in its bundle, so it begins at the PIN. */
  isBypassed: boolean
}

type UseSignInFlowProps = {
  copy: SignInCopy
  initial: { email: string; password: string }
  /** Where a finished sign-in goes, and the tickets-off Continue. */
  onDone: () => void
}

type SubmitAccountProps = { password?: string }

type SubmitSecretProps = { step: SecretStep; text: string }

/**
 * The hook that runs sign-in's steps, as both apps do: the account's email and password, then
 * the PIN when the account may see locked libraries, then the admin password while the admin
 * lock would still hide them. Each screen keeps its fields, its layout and its copy. Made per
 * app at module scope, since a store handed to a hook at render reads to the hooks rule as a
 * hook used as a value.
 */
export const signInFlowFor = ({
  account,
  servers,
  apiOf,
  server: ravenServer,
  isBypassed,
}: SignInFlowForProps) => {
  const useSignInFlow = ({ copy, initial, onDone }: UseSignInFlowProps) => {
    const [step, setStep] = useState<SignInStep>(
      isBypassed
        ? { kind: SIGN_IN_STEPS.pin, server: ravenServer }
        : { kind: SIGN_IN_STEPS.account },
    )
    const [email, setEmail] = useState(initial.email)
    const [password, setPassword] = useState(initial.password)
    const [secret, setSecret] = useState('')
    const { isBusy, error, setError, run } = useSubmit({ unreachable: copy.unreachable })

    const secretSteps = {
      [SIGN_IN_STEPS.pin]: { prompt: copy.pinPrompt, label: copy.pin, isNumeric: true },
      [SIGN_IN_STEPS.admin]: {
        prompt: copy.adminPrompt,
        label: copy.adminPassword,
        isNumeric: false,
      },
    } as const satisfies Record<SecretStep['kind'], SecretPrompt>

    const askFor = (next: SignInStep) => {
      setSecret('')
      setStep(next)
    }

    const finish = async (server: AppServer) => {
      const outcome = await finishSignIn({ servers, server, api: apiOf(server) })
      switch (outcome) {
        case FINISH_OUTCOMES.done:
          onDone()
          return
        case FINISH_OUTCOMES.ticketsOff:
          askFor({ kind: SIGN_IN_STEPS.ticketsOff })
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
        const next = await stepAfterAccount({ api: apiOf(ravenServer), server: ravenServer })
        if (next !== null) {
          askFor(next)
          return
        }
        await finish(ravenServer)
      })
    }

    const submitSecret = ({ step: secretStep, text }: SubmitSecretProps) =>
      run(async () => {
        const { server } = secretStep
        const next = await stepAfterSecret({ api: apiOf(server), step: secretStep, secret: text })
        if (next !== null) {
          askFor(next)
          return
        }
        await finish(server)
      })

    const notNow = (secretStep: SecretStep) => run(() => finish(secretStep.server))

    const signOut = () => {
      account.getState().signOut()
      askFor({ kind: SIGN_IN_STEPS.account })
      setError(null)
    }

    return {
      step,
      email,
      setEmail,
      password,
      setPassword,
      secret,
      setSecret,
      isBusy,
      error,
      secretSteps,
      submitAccount,
      submitSecret,
      notNow,
      signOut,
    }
  }
  return useSignInFlow
}
