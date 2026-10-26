import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/Button/Button'
import styles from '@/components/SandboxBar/SandboxBar.module.scss'
import {
  SANDBOX_TIERS,
  type SandboxState,
  type Tier,
  isSandboxTier,
  openCase,
  setSandboxTier,
} from '@/lib/api'
import { QUERY_KEYS } from '@/lib/queryKeys'
import { useChat } from '@/stores/chat'

type SandboxBarProps = { state: SandboxState; tier: Tier }

/** The sandbox's controls: which case's fakes luwin runs in, at which tier, and a fresh start. */
export const SandboxBar = ({ state, tier }: SandboxBarProps) => {
  const queryClient = useQueryClient()
  const isBusy = useChat((chat) => chat.isBusy)
  const startOver = useChat((chat) => chat.startOver)

  const caseChange = useMutation({
    mutationFn: openCase,
    onSuccess: (opened) => {
      // The new world's id hands the page a fresh conversation (`useChat`'s `adopt`).
      queryClient.setQueryData(QUERY_KEYS.sandbox, opened)
      return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.me })
    },
  })
  const tierChange = useMutation({
    mutationFn: setSandboxTier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.me }),
  })
  const isLocked = isBusy || caseChange.isPending || tierChange.isPending

  return (
    <section className={styles.bar} aria-label="Sandbox">
      <div className={styles.controls}>
        <p className={styles.badge}>
          Sandbox · {state.model} · raven {state.raven ?? 'fake'}
        </p>
        <label className={styles.caseField}>
          <span className={styles.label}>Case</span>
          <select
            className={styles.select}
            value={state.case.id}
            disabled={isLocked}
            onChange={(event) => caseChange.mutate({ id: event.target.value })}
          >
            {state.cases.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.tierField}>
          <span className={styles.label}>Tier</span>
          <select
            className={styles.select}
            value={tier}
            disabled={isLocked}
            onChange={(event) => {
              const picked = event.target.value
              if (isSandboxTier(picked)) tierChange.mutate({ tier: picked })
            }}
          >
            {SANDBOX_TIERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <Button className={styles.reset} disabled={isLocked} onClick={() => void startOver()}>
          Start over
        </Button>
      </div>
      {(caseChange.isError || tierChange.isError) && (
        <p className={styles.error} role="alert">
          The sandbox didn't take that; is it still running?
        </p>
      )}
    </section>
  )
}
