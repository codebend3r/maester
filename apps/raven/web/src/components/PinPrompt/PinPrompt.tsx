import { useQueryClient } from '@tanstack/react-query'
import { UnlockDialog } from '@raven/ui'
import { api } from '@/lib/api'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/** Asks for the PIN whenever something sits in a locked library, and every page reads again. */
export const PinPrompt = () => {
  const isOpen = useUnlockPrompt((state) => state.open)
  const close = useUnlockPrompt((state) => state.close)
  const queryClient = useQueryClient()
  return (
    isOpen && (
      <UnlockDialog
        secret="pin"
        unlock={(entered) => api.unlock(entered)}
        onUnlocked={() => {
          close()
          return queryClient.invalidateQueries()
        }}
        onClose={close}
      />
    )
  )
}
