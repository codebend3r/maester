import { queryOptions } from '@tanstack/react-query'
import { isLockedError } from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { api } from '@/lib/api'

const BINGE_QUERY = 'binge' as const

/** Passive cards must not request a PIN or cache a refusal as an interactive item's answer. */
export const bingeQuery = (id: number) =>
  queryOptions({
    queryKey: [...queryKeys.item(id), BINGE_QUERY],
    queryFn: async () => {
      try {
        return await api.getItem(id)
      } catch (error) {
        if (isLockedError(error)) return null
        throw error
      }
    },
  })
