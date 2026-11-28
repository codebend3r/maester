import { apiFor } from '@raven/native'
import {
  type DeviceLink,
  RAVEN_SERVER,
  SIGN_IN_ERRORS,
  SIGN_IN_STEPS,
  type SignInErrorCopy,
  type SignInStep,
  signInErrorTextOf,
  signInFlowFor,
} from '@raven/native/headless'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import type { Dispatch, SetStateAction } from 'react'

import { Text } from '@/layouts/Text'
import { BUTTON_TONES, Field, Form, FormButton, ScanPanel, useFormStyles } from '@/layouts'
import { useAccountSession } from '@/account/session'
import { TEST_ACCOUNT } from '@/account/testAccount'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { APP_PLATFORMS, type AppPlatform } from '@/platform/platform'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'

/** What each sign-in error says; a refusal says the service's or the server's own words. */
const SIGN_IN_ERROR_COPY = {
  [SIGN_IN_ERRORS.missing]: SIGN_IN_COPY.badAccount,
  [SIGN_IN_ERRORS.badCredentials]: SIGN_IN_COPY.wrongAccount,
  [SIGN_IN_ERRORS.unreachable]: SIGN_IN_COPY.unreachable,
  [SIGN_IN_ERRORS.full]: SIGN_IN_COPY.full,
  [SIGN_IN_ERRORS.notAdded]: SIGN_IN_COPY.notAdded,
} as const satisfies SignInErrorCopy

/*
 * What each TV calls itself to the phone approving its code. A phone or a tablet has none: it
 * signs in with its own keyboard, so it starts no code and shows none.
 */
const DEVICE_NAMES = {
  [APP_PLATFORMS.tvos]: SIGN_IN_COPY.deviceNames.tvos,
  [APP_PLATFORMS.androidTv]: SIGN_IN_COPY.deviceNames.androidTv,
  [APP_PLATFORMS.ios]: null,
  [APP_PLATFORMS.androidPhone]: null,
} as const satisfies Record<AppPlatform, string | null>

/** How to fill a field without the remote's keyboard, where the remote has no button for it on screen. */
const ENTRY_HINTS = {
  [APP_PLATFORMS.tvos]: SIGN_IN_COPY.appleTvHint,
  // Android TV draws a "say it" button under each field (`ListenButton`), which says it all.
  [APP_PLATFORMS.androidTv]: null,
  [APP_PLATFORMS.ios]: null,
  [APP_PLATFORMS.androidPhone]: null,
} as const satisfies Record<AppPlatform, string | null>

const ENTRY_HINT = ENTRY_HINTS[DEVICE_PLATFORM]

type ErrorLineProps = { error: string | null }

/** What went wrong with the last submit, read out as it changes. */
const ErrorLine = ({ error }: ErrorLineProps) => {
  const formStyles = useFormStyles()
  return (
    error !== null && (
      <Text accessibilityLiveRegion="polite" style={formStyles.error}>
        {error}
      </Text>
    )
  )
}

type AccountFormProps = {
  email: string
  setEmail: Dispatch<SetStateAction<string>>
  password: string
  setPassword: Dispatch<SetStateAction<string>>
  error: string | null
  isBusy: boolean
  onSubmit: (typedPassword?: string) => void
  link: DeviceLink | null
  onRenewLink: () => void
}

/** The account's email and password, and on a TV the code a phone scans to skip both. */
const AccountForm = ({
  email,
  setEmail,
  password,
  setPassword,
  error,
  isBusy,
  onSubmit,
  link,
  onRenewLink,
}: AccountFormProps) => {
  const formStyles = useFormStyles()
  return (
    <Form
      aside={link !== null && <ScanPanel link={link} onRenew={onRenewLink} />}
      title={SIGN_IN_COPY.title}
    >
      <Field
        isEmail
        isFirst={TEST_ACCOUNT === null}
        label={SIGN_IN_COPY.email}
        onChangeText={setEmail}
        onSubmit={({ text }) => setEmail(text)}
        value={email}
      />
      <Field
        isSecret
        label={SIGN_IN_COPY.password}
        onChangeText={setPassword}
        onSubmit={({ text }) => {
          setPassword(text)
          onSubmit(text)
        }}
        value={password}
      />
      {ENTRY_HINT !== null && <Text style={formStyles.note}>{ENTRY_HINT}</Text>}
      <ErrorLine error={error} />
      <FormButton
        isDisabled={isBusy}
        isFirst={TEST_ACCOUNT !== null}
        label={SIGN_IN_COPY.signIn}
        onPress={() => onSubmit()}
        tone={BUTTON_TONES.primary}
      />
    </Form>
  )
}

type TicketsOffFormProps = { onContinue: () => void }

/** A server without media tickets, said in the spec's words before Home. */
const TicketsOffForm = ({ onContinue }: TicketsOffFormProps) => {
  const formStyles = useFormStyles()
  return (
    <Form title={SIGN_IN_COPY.title}>
      <Text accessibilityLiveRegion="polite" style={formStyles.notice}>
        {SIGN_IN_COPY.ticketsOff}
      </Text>
      <FormButton label={SIGN_IN_COPY.continue} onPress={onContinue} tone={BUTTON_TONES.primary} />
    </Form>
  )
}

type SignInViewProps = {
  [SIGN_IN_STEPS.account]: AccountFormProps
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffFormProps
}

const SIGN_IN_VIEWS = {
  [SIGN_IN_STEPS.account]: AccountForm,
  [SIGN_IN_STEPS.ticketsOff]: TicketsOffForm,
} as const satisfies ViewsOf<SignInViewProps>

type SignInViewOfProps = {
  step: SignInStep
  account: AccountFormProps
  ticketsOff: TicketsOffFormProps
}

const signInViewOf = ({
  step,
  account,
  ticketsOff,
}: SignInViewOfProps): ViewOf<SignInViewProps> => {
  switch (step.kind) {
    case SIGN_IN_STEPS.account:
      return { key: SIGN_IN_STEPS.account, props: account }
    case SIGN_IN_STEPS.ticketsOff:
      return { key: SIGN_IN_STEPS.ticketsOff, props: ticketsOff }
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

const useSignInFlow = signInFlowFor({
  account: useAccountSession,
  servers: useActiveServer,
  apiOf: (server) => apiFor({ server, session: useAccountSession }),
  server: RAVEN_SERVER,
})

/**
 * The first launch: the account's email and password (the web's Supabase sign-in, against the
 * one server the app talks to), over `@raven/native`'s `signInFlowFor`, and on a TV a code to
 * scan with a phone instead of typing either. It never asks for a PIN.
 */
export const SignIn = () => {
  const router = useRouter()
  // From Settings, Home is under it in the stack: go back down to it rather than stack another.
  const goHome = () => router.dismissTo(APP_ROUTES.home)
  const {
    step,
    email,
    setEmail,
    password,
    setPassword,
    isBusy,
    error,
    submitAccount,
    link,
    renewLink,
  } = useSignInFlow({
    initial: { email: TEST_ACCOUNT?.email ?? '', password: TEST_ACCOUNT?.password ?? '' },
    onDone: goHome,
    deviceName: DEVICE_NAMES[DEVICE_PLATFORM] ?? undefined,
  })

  const view = signInViewOf({
    step,
    account: {
      email,
      setEmail,
      password,
      setPassword,
      error: error === null ? null : signInErrorTextOf({ error, copy: SIGN_IN_ERROR_COPY }),
      isBusy,
      onSubmit: (typedPassword) => submitAccount({ password: typedPassword }),
      link,
      onRenewLink: renewLink,
    },
    ticketsOff: { onContinue: goHome },
  })
  return <KeyedView<SignInViewProps> view={view} views={SIGN_IN_VIEWS} />
}
