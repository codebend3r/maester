import { QueryView, type QueryRead, isNone } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import styles from '@/components/ListState/ListState.module.scss'

type ReadOfProps<T> = {
  entries: readonly T[] | undefined
  error: Error | null
}

/** A list's read: its failure first, then on its way, then read. */
const readOf = <T,>({ entries, error }: ReadOfProps<T>): QueryRead<readonly T[]> => {
  if (error !== null) return { isError: true, error }
  if (entries === undefined) return { isError: false, isPending: true }
  return { isError: false, isPending: false, data: entries }
}

type ListStateProps<T> = ReadOfProps<T> & {
  /** What the list says when it holds nothing. */
  empty: string
  /** What stands in while it is read; nothing when left out. */
  loading?: ReactNode
  children: (entries: readonly T[]) => ReactNode
}

/** A list in whichever state it stands: why it failed, its stand-in, its empty line, or its entries. */
export const ListState = <T,>({
  entries,
  error,
  empty,
  loading = null,
  children,
}: ListStateProps<T>) => (
  <QueryView
    query={readOf({ entries, error })}
    pending={loading}
    renderFailed={(failure) => (
      <p className={styles.message} role="alert">
        {failure.message}
      </p>
    )}
    empty={{ isEmpty: isNone, shown: <p className={styles.message}>{empty}</p> }}
  >
    {children}
  </QueryView>
)
