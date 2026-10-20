import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signOut } from '@/lib/session'

/** Signing out, as a mutation a Sign out button shows the progress and failure of. */
export const useSignOut = () => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: () => signOut({ queryClient }) })
}
