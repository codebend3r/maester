import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { USAGE_METER_COPY } from '@/components/UsageMeter/copy'
import styles from '@/components/UsageMeter/UsageMeter.module.scss'
import { type Usage, fetchUsage } from '@/lib/api'
import { QUERY_KEYS } from '@/lib/queryKeys'
import { useChat } from '@/stores/chat'

// Under this share of the budget left, the bar turns to warn.
const LOW_SHARE = 0.15

type Budget = NonNullable<Usage['budget']>

type BudgetBarProps = { budget: Budget }

/** How much of today's budget is left: a bar, then the count. */
const BudgetBar = ({ budget }: BudgetBarProps) => {
  const left = Math.max(budget.total - budget.used, 0)
  const share = left / budget.total
  const words = USAGE_METER_COPY.left({ left, total: budget.total })
  return (
    <>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.track} aria-hidden="true">
        <span
          className={share < LOW_SHARE ? styles.low : styles.fill}
          style={{ inlineSize: `${share * 100}%` }}
        />
      </span>
      <span className={styles.count}>
        <span className={styles.strong}>{words.left}</span>
        {words.rest}
      </span>
    </>
  )
}

/** The model answering and today's token budget, read again after every turn. */
export const UsageMeter = () => {
  const queryClient = useQueryClient()
  const usage = useQuery({ queryKey: QUERY_KEYS.usage, queryFn: fetchUsage })
  const isBusy = useChat((state) => state.isBusy)

  useEffect(() => {
    if (!isBusy) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.usage })
  }, [isBusy, queryClient])

  return (
    !!usage.data && (
      <p className={styles.meter} aria-label={USAGE_METER_COPY.label}>
        <span className={styles.model}>{usage.data.model}</span>
        {usage.data.budget && <BudgetBar budget={usage.data.budget} />}
      </p>
    )
  )
}
