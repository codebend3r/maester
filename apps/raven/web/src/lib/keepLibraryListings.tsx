import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { ACCESS_KINDS, type AccessState, useAccessState } from '@/lib/accessState'
import { listedLibraryOf } from '@/lib/libraryListing'
import { listingStore } from '@/lib/listingStore'
import { librariesQuery } from '@/lib/queries'
import { OPEN_SCOPE, keepListings } from '@/lib/savedListings'

/** Whose listings these are, or null while no one is served. */
const scopeOf = (access: AccessState): string | null => {
  switch (access.kind) {
    case ACCESS_KINDS.approved:
      return access.account.id
    case ACCESS_KINDS.disabled:
      return OPEN_SCOPE
    case ACCESS_KINDS.unavailable:
    case ACCESS_KINDS.loading:
    case ACCESS_KINDS.signedOut:
    case ACCESS_KINDS.failed:
    case ACCESS_KINDS.pending:
    case ACCESS_KINDS.revoked:
      return null
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}

type KeepProps = { scope: string }

const Keep = ({ scope }: KeepProps) => {
  const queryClient = useQueryClient()
  // Narrowed to what decides the work, so the refreshes a scan brings leave the list as it was and the work running.
  const libraries = useQuery({
    ...librariesQuery,
    select: (all) => all.map(listedLibraryOf),
  })

  useEffect(() => {
    const listed = libraries.data ?? []
    if (listed.length === 0) return
    const controller = new AbortController()
    keepListings({
      store: listingStore,
      scope,
      queryClient,
      libraries: listed,
      signal: controller.signal,
    }).catch((error) => console.error(error))
    return () => controller.abort()
  }, [queryClient, scope, libraries.data])

  return null
}

type KeepLibraryListingsProps = { children: ReactNode }

/**
 * Once the viewer is served, puts back the library listings this device
 * saved, reads the rest in the background one library at a time while the
 * browser is idle, and keeps the cache saved for the next visit. It waits
 * for an approved account when accounts are on, as the server answers no
 * one else, and keeps each account's listings apart.
 */
export const KeepLibraryListings = ({ children }: KeepLibraryListingsProps) => {
  const scope = scopeOf(useAccessState())
  return (
    <>
      {scope !== null && <Keep scope={scope} />}
      {children}
    </>
  )
}
