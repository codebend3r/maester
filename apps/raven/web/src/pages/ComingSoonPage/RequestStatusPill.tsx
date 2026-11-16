import type { RequestStatus } from '@raven/core'
import { REQUEST_STATUS_COPY } from '@/pages/ComingSoonPage/requestCopy'
import styles from '@/pages/ComingSoonPage/RequestStatusPill.module.scss'

type RequestStatusPillProps = { status: RequestStatus; className?: string }

/** Where a request stands, as a pill in a table's row: the leaf fill once a copy is found, amber while none is. */
export const RequestStatusPill = ({ status, className }: RequestStatusPillProps) => (
  <span className={[styles.pill, className].filter(Boolean).join(' ')} data-status={status}>
    {REQUEST_STATUS_COPY[status].label}
  </span>
)
