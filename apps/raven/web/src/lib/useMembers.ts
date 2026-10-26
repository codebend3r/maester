import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { membersQuery } from '@/lib/queries'
import { queryKeys } from '@raven/ui/headless'

type UseMembersProps = { userId: string }

/**
 * The accounts on this raven for the owner `userId`, and the change of one
 * account's access. A change is pending until the list has been read again,
 * so the row it moved is in its new tab by the time the buttons are back.
 */
export const useMembers = ({ userId }: UseMembersProps) => {
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery(userId))
  const setStatus = useMutation({
    mutationFn: (request: Parameters<typeof api.setMemberStatus>[0]) =>
      api.setMemberStatus(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(userId) }),
  })
  return { members, setStatus }
}
