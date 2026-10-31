import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/Button/Button'
import { SIDEBAR_COPY } from '@/components/Sidebar/copy'
import styles from '@/components/Sidebar/Sidebar.module.scss'
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

type SandboxControlsProps = { world: SandboxState; tier: Tier }

/** Which case's fakes sparrow runs in, at which tier, and that case's own messages. */
const SandboxControls = ({ world, tier }: SandboxControlsProps) => {
  const queryClient = useQueryClient()
  const isBusy = useChat((chat) => chat.isBusy)
  const send = useChat((chat) => chat.send)

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
  const turns = world.case.turns

  return (
    <>
      <div className={styles.pickers}>
        <label className={styles.caseField}>
          <span className={styles.label}>{SIDEBAR_COPY.case}</span>
          <select
            className={styles.select}
            value={world.case.id}
            disabled={isLocked}
            onChange={(event) => caseChange.mutate({ id: event.target.value })}
          >
            {world.cases.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.tierField}>
          <span className={styles.label}>{SIDEBAR_COPY.tier}</span>
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
        {(caseChange.isError || tierChange.isError) && (
          <p className={styles.error} role="alert">
            {SIDEBAR_COPY.failed}
          </p>
        )}
      </div>
      {turns.length > 0 && (
        <section className={styles.turns} aria-labelledby="case-messages-heading">
          <h2 id="case-messages-heading" className={styles.heading}>
            {SIDEBAR_COPY.caseMessages}
          </h2>
          <ol className={styles.list}>
            {turns.map((turn) => (
              <li key={turn.user}>
                <button
                  type="button"
                  className={styles.turn}
                  disabled={isBusy}
                  onClick={() => void send({ text: turn.user, expected: turn })}
                >
                  {turn.user}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

type SidebarProps = { world: SandboxState | null; tier: Tier }

/** The sidebar: sparrow's name, the sandbox's controls when it is one, and a fresh start. */
export const Sidebar = ({ world, tier }: SidebarProps) => {
  const isBusy = useChat((chat) => chat.isBusy)
  const startOver = useChat((chat) => chat.startOver)
  return (
    <aside className={styles.sidebar} aria-label={SIDEBAR_COPY.label}>
      <h1 className={styles.wordmark}>{SIDEBAR_COPY.wordmark}</h1>
      {world && <SandboxControls world={world} tier={tier} />}
      <footer className={styles.footer}>
        {world && (
          <p className={styles.environment}>
            <span className={styles.sandbox}>{SIDEBAR_COPY.sandbox}</span>
            <span>{SIDEBAR_COPY.environment({ raven: world.raven })}</span>
          </p>
        )}
        <Button className={styles.startOver} disabled={isBusy} onClick={() => void startOver()}>
          {SIDEBAR_COPY.startOver}
        </Button>
      </footer>
    </aside>
  )
}
