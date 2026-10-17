import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { Button } from '@raven/ui'
import styles from '@/renderer/SettingsPage/Updates.module.scss'
import { UNOPENED, UPDATES_KEY } from '@/renderer/Shell/updateState'
import { useDesktop } from '@/renderer/stores/desktop'
import { useUpdateNotice } from '@/renderer/stores/updateNotice'
import {
  DESKTOP_REPLIES,
  type DESKTOP_REQUESTS,
  type DesktopRequest,
  type UpdateStatus,
} from '@/shared/protocol'

// Main's `UPDATE_COPY`, repeated: the page cannot import main.
const COPY = {
  newer: (version: string) => `raven player ${version} is out.`,
  current: (version: string) => `raven player ${version} is the newest release.`,
  failed: (problem: string) => `raven player could not check for updates. ${problem}`,
} as const

const UNREADABLE = 'raven player could not read its update settings.'
const UNCHANGED = 'raven player could not change its update check. Try again.'
const UNCHECKED = 'raven player could not check for updates. Try again.'

/** The result lines a status holds; "newest" only from a check this visit just ran. */
const resultsOf = ({
  status,
  hasJustChecked,
}: {
  status: UpdateStatus
  hasJustChecked: boolean
}): string[] => {
  const newer = status.latest === null ? [] : [COPY.newer(status.latest)]
  const failed = status.problem === null ? [] : [COPY.failed(status.problem)]
  const lines = [...newer, ...failed]
  // A stored null `latest` says only that this session has not found one, not that none exists.
  if (lines.length === 0 && hasJustChecked) return [COPY.current(status.current)]
  return lines
}

/** The release check: the daily switch, the running version, and what the last check found. */
export const Updates = ({ className }: { className?: string }) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const hideUpdate = useUpdateNotice((state) => state.hide)
  const hintId = useId()
  const isCheckingNow = useRef(false)
  const [isChecking, setIsChecking] = useState(false)
  // Bumped on each answer, so the results remount and the live region speaks them again.
  const [round, setRound] = useState(0)
  const [hasJustChecked, setHasJustChecked] = useState(false)
  const [refusal, setRefusal] = useState('')
  // The switch as the person last set it, shown until main answers that pick.
  const [picked, setPicked] = useState<boolean | null>(null)
  const lastPick = useRef(0)

  const read = useQuery({
    queryKey: UPDATES_KEY,
    queryFn: async (): Promise<UpdateStatus> => {
      const reply = await client.request({ type: 'readUpdates' })
      if (reply.type === DESKTOP_REPLIES.updates) return reply.status
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : UNREADABLE)
    },
    retry: false,
  })

  /** Sends `request` and keeps the status main answers with; false when it answered otherwise. */
  const send = async ({
    request,
    fallback,
  }: {
    request: Extract<
      DesktopRequest,
      { type: typeof DESKTOP_REQUESTS.setUpdateCheck | typeof DESKTOP_REQUESTS.checkForUpdates }
    >
    fallback: string
  }): Promise<boolean> => {
    setRefusal('')
    const reply = await client.request(request).catch(() => null)
    if (reply === null || reply.type !== DESKTOP_REPLIES.updates) {
      setRefusal(
        reply !== null && reply.type === DESKTOP_REPLIES.refused ? reply.message : fallback,
      )
      return false
    }
    queryClient.setQueryData(UPDATES_KEY, reply.status)
    return true
  }

  const setEnabled = async (isEnabled: boolean) => {
    lastPick.current += 1
    const pick = lastPick.current
    setPicked(isEnabled)
    await send({ request: { type: 'setUpdateCheck', isEnabled }, fallback: UNCHANGED })
    if (pick === lastPick.current) setPicked(null)
  }

  const checkNow = async () => {
    if (isCheckingNow.current) return
    isCheckingNow.current = true
    setIsChecking(true)
    const isAnswered = await send({ request: { type: 'checkForUpdates' }, fallback: UNCHECKED })
    isCheckingNow.current = false
    setIsChecking(false)
    if (!isAnswered) return
    setHasJustChecked(true)
    setRound((current) => current + 1)
  }

  const openRelease = async () => {
    setRefusal('')
    const reply = await client.request({ type: 'openRelease' }).catch(() => null)
    // The page is open now, so the Shell's notice has said what it had to.
    if (reply !== null && reply.type === DESKTOP_REPLIES.done) return hideUpdate()
    setRefusal(reply !== null && reply.type === DESKTOP_REPLIES.refused ? reply.message : UNOPENED)
  }

  const status = read.data ?? null
  const results = status === null ? [] : resultsOf({ status, hasJustChecked })

  return (
    <section className={`${styles.updates} ${className ?? ''}`} aria-labelledby="updates-title">
      <h2 id="updates-title">Updates</h2>
      {read.isError && (
        <p className={styles.refusal} role="alert">
          {read.error.message}
        </p>
      )}
      {status !== null && (
        <>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={picked ?? status.isEnabled}
              aria-describedby={hintId}
              onChange={(event) => void setEnabled(event.target.checked)}
            />
            Check for updates once a day
          </label>
          <p id={hintId} className={styles.hint}>
            raven player asks GitHub for its newest release and sends nothing else. It never
            installs one by itself.
          </p>
          <p>This is raven player {status.current}.</p>
          <p>
            {status.checkedAt === null
              ? 'Not checked yet.'
              : `Last checked ${new Date(status.checkedAt).toLocaleString()}.`}
          </p>
        </>
      )}
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output className={styles.results}>
        {results.length > 0 && (
          <span key={round} className={styles.lines}>
            {results.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        )}
      </output>
      {status !== null && (
        <div className={styles.actions}>
          {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
          <Button aria-disabled={isChecking} onClick={() => void checkNow()}>
            Check now
          </Button>
          {status.latest !== null && (
            <Button tone="primary" onClick={() => void openRelease()}>
              See what's new
            </Button>
          )}
        </div>
      )}
      {refusal !== '' && (
        <p className={styles.refusal} role="alert" data-refused="true">
          {refusal}
        </p>
      )}
    </section>
  )
}
