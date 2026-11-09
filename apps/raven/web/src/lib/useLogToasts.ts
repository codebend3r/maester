import { useQueryClient } from '@tanstack/react-query'
import { type Toast, useToasts } from '@raven/ui'
import { afterNotification } from '@raven/ui/headless'
import { useEffect } from 'react'
import { api } from '@/lib/api'

type NewToastsProps = { toasts: readonly Toast[]; before: readonly Toast[] }

/** The toasts that just appeared and that the server has not logged yet. */
export const unloggedToasts = ({ toasts, before }: NewToastsProps): Toast[] => {
  const seen = new Set(before.map(({ id }) => id))
  return toasts.filter((toast) => !toast.isLogged && !seen.has(toast.id))
}

/**
 * Logs each toast this screen raises on the server as it appears, under
 * the signed-in account, so the Notifications page holds it when it was
 * missed. One the server sent is logged already. A toast that cannot be
 * logged (signed out, or the server out of reach) still shows.
 */
export const useLogToasts = (): void => {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      useToasts.subscribe((state, previous) =>
        unloggedToasts({ toasts: state.toasts, before: previous.toasts }).forEach(
          ({ message, tone }) => {
            api
              .logNotification({ message, tone })
              .then(() => afterNotification(queryClient))
              .catch(() => undefined)
          },
        ),
      ),
    [queryClient],
  )
}
