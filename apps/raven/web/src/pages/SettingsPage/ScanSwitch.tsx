import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SCAN_CONTROL_PATH, type ScanControlState } from '@raven/core'
import { Button } from '@raven/ui'
import { api } from '@/lib/api'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

const SCAN_QUERY = { queryKey: [SCAN_CONTROL_PATH], queryFn: () => api.getScanControl() } as const

export const ScanSwitch = () => {
  const client = useQueryClient()
  const state = useQuery({ ...SCAN_QUERY, refetchInterval: 5000 })
  const change = useMutation({
    mutationFn: (next: ScanControlState) => api.setScanControl(next),
    onSuccess: (next) => client.setQueryData(SCAN_QUERY.queryKey, next),
    onSettled: () => client.invalidateQueries({ queryKey: SCAN_QUERY.queryKey, exact: true }),
  })
  const error = state.error ?? change.error
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{ADMIN_COPY.scans}</h2>
      <p className={styles.help}>{ADMIN_COPY.hint}</p>
      {state.data && (
        <Button
          disabled={change.isPending}
          onClick={() => change.mutate({ isStopped: !state.data.isStopped })}
        >
          {state.data.isStopped ? ADMIN_COPY.resume : ADMIN_COPY.stop}
        </Button>
      )}
      {state.data?.isStopped && <output>{ADMIN_COPY.stopped}</output>}
      {error && <p role="alert">{error.message}</p>}
    </section>
  )
}
