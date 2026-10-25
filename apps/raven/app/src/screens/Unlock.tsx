import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Text } from '@/layouts/Text'
import { useAppQueries } from '@/queries/useAppQueries'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { APP_ROUTES } from '@/routes'
import { useSubmit } from '@/screens/useSubmit'

const COPY = {
  prompt: 'What you opened sits in a library this server keeps behind its PIN.',
  pin: 'PIN',
  unlock: 'Unlock',
  notNow: 'Not now',
  unreachable: "Couldn't reach the server. Check that raven is running.",
} as const

/**
 * `/unlock`: the PIN, asked for when a page is refused for sitting in a locked library. Once
 * the server takes it, every query is read again, the locked libraries with them, and the
 * viewer goes back to where they were.
 */
export const Unlock = () => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const formStyles = useFormStyles()
  const session = useAppQueries()
  const [pin, setPin] = useState('')
  const { isBusy, error, run } = useSubmit({ unreachable: COPY.unreachable })

  const leave = () => {
    if (!router.canGoBack()) {
      router.replace(APP_ROUTES.home)
      return
    }
    router.back()
  }

  const submit = () =>
    run(async () => {
      if (session === null) return
      await session.api.unlock(pin)
      await queryClient.invalidateQueries()
      leave()
    })

  return (
    <Form title={session?.server.name ?? ''}>
      <Text style={formStyles.note}>{COPY.prompt}</Text>
      <Field
        isFirst
        isNumeric
        isSecret
        label={COPY.pin}
        onChangeText={setPin}
        onSubmit={() => submit()}
        value={pin}
      />
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={formStyles.error}>
          {error}
        </Text>
      )}
      <FormButton
        isDisabled={isBusy}
        label={COPY.unlock}
        onPress={() => submit()}
        tone={BUTTON_TONES.primary}
      />
      <FormButton
        isDisabled={isBusy}
        label={COPY.notNow}
        onPress={leave}
        tone={BUTTON_TONES.quiet}
      />
    </Form>
  )
}
