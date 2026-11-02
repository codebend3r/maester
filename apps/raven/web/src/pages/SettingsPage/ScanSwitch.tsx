import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RATINGS_REFRESH_STATES, SCAN_KINDS, SCAN_STATES, type Library } from '@raven/core'
import { Button, Icon } from '@raven/ui'
import { api } from '@/lib/api'
import { librariesQuery } from '@/lib/queries'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

type ActiveWork = { library: Library; label: string; cancel: () => Promise<Library> }

const activeWorkOf = (libraries: Library[]): ActiveWork[] =>
  libraries.flatMap((library) => {
    const scan =
      library.scan.state === SCAN_STATES.idle
        ? []
        : [
            {
              library,
              label:
                library.scan.kind === SCAN_KINDS.quick ? ADMIN_COPY.quickScan : ADMIN_COPY.fullScan,
              cancel: () =>
                library.scan.kind === SCAN_KINDS.quick
                  ? api.cancelQuickScan(library.id)
                  : api.cancelScan(library.id),
            },
          ]
    const ratings =
      library.ratingsRefresh.state === RATINGS_REFRESH_STATES.running
        ? [
            {
              library,
              label: ADMIN_COPY.ratings,
              cancel: () => api.cancelLibraryRatings(library.id),
            },
          ]
        : []
    return [...scan, ...ratings]
  })

export const ScanSwitch = () => {
  const client = useQueryClient()
  const state = useQuery({ ...librariesQuery, refetchInterval: 2000 })
  const cancel = useMutation({
    mutationFn: async () => {
      const running = activeWorkOf(state.data ?? [])
      await Promise.all(running.map(({ cancel: cancelOne }) => cancelOne()))
    },
    onSettled: () => client.invalidateQueries({ queryKey: librariesQuery.queryKey, exact: true }),
  })
  const running = activeWorkOf(state.data ?? [])
  const error = state.error ?? cancel.error
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        <Icon name="libraries" />
        {ADMIN_COPY.scans}
      </h2>
      <p className={styles.help}>{ADMIN_COPY.hint}</p>
      {state.data && (
        <>
          <ul className={styles.scanList}>
            {running.map(({ library, label }) => (
              <li key={`${library.id}-${label}`}>
                {library.name}: {label}
              </li>
            ))}
          </ul>
          <Button
            disabled={cancel.isPending || running.length === 0}
            onClick={() => cancel.mutate()}
          >
            {ADMIN_COPY.stop}
          </Button>
        </>
      )}
      {error && <p role="alert">{error.message}</p>}
    </section>
  )
}
