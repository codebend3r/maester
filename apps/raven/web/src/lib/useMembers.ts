import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { membersQuery } from '@/lib/queries'
import {
  memberStatusEdits,
  mutationKeys,
  queryKeys,
  useOptimisticMutation,
} from '@raven/ui/headless'

type UseMembersProps = { userId: string }

/**
 * The accounts on this raven for the owner `userId`, and the change of one
 * account's access. A change moves its row to its new tab at once, goes
 * back if the server refuses it, and the list is read again once the last
 * change settles.
 */
export const useMembers = ({ userId }: UseMembersProps) => {
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery(userId))
  const setStatus = useOptimisticMutation({
    mutationKey: mutationKeys.members,
    mutationFn: (request: Parameters<typeof api.setMemberStatus>[0]) =>
      api.setMemberStatus(request),
    edits: ({ id, change }) => memberStatusEdits({ userId, id, change }),
    settle: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(userId) }),
  })
  return { members, setStatus }
}
