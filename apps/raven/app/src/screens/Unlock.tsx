import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Text } from '@/layouts/Text'
import { useAppQueries } from '@/queries/useAppQueries'
import { BUTTON_TONES, Field, Form, FormButton, useFormStyles } from '@/layouts'
import { APP_ROUTES } from '@/routes'
import { UNLOCK_COPY } from '@/screens/copy'
import { useSubmit } from '@/screens/useSubmit'

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
  const { isBusy, error, run } = useSubmit({ unreachable: UNLOCK_COPY.unreachable })

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
      <Text style={formStyles.note}>{UNLOCK_COPY.prompt}</Text>
      <Field
        isFirst
        isNumeric
        isSecret
        label={UNLOCK_COPY.pin}
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
        label={UNLOCK_COPY.unlock}
        onPress={() => submit()}
        tone={BUTTON_TONES.primary}
      />
      <FormButton
        isDisabled={isBusy}
        label={UNLOCK_COPY.notNow}
        onPress={leave}
        tone={BUTTON_TONES.quiet}
      />
    </Form>
  )
}
