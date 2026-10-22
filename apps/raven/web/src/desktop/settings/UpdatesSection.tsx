import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopRequest,
  UPDATE_WORDS,
  type UpdateStatus,
} from '@raven/core'
import { Button } from '@raven/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { refusalText } from '@/desktop/client'
import { handled } from '@/desktop/handled'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { Section } from '@/desktop/settings/Section'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'

const UNREADABLE = 'raven player could not read its update settings.'
const UNCHANGED = 'raven player could not change its update check. Try again.'
const UNCHECKED = 'raven player could not check for updates. Try again.'
const UNOPENED = 'raven player could not open the release page. Try again.'

/** The result lines a status holds; "newest" only from a check this visit just ran. */
const resultsOf = ({
  status,
  hasJustChecked,
}: {
  status: UpdateStatus
  hasJustChecked: boolean
}): string[] => {
  const newer = status.latest === null ? [] : [UPDATE_WORDS.newer(status.latest)]
  const failed = status.problem === null ? [] : [`${UPDATE_WORDS.failed} ${status.problem}`]
  const lines = [...newer, ...failed]
  // A stored null `latest` says only that this session has not found one, not that none exists.
  if (lines.length === 0 && hasJustChecked) return [UPDATE_WORDS.current(status.current)]
  return lines
}

type UpdateRequest = Extract<
  DesktopRequest,
  { type: typeof DESKTOP_REQUESTS.setUpdateCheck | typeof DESKTOP_REQUESTS.checkForUpdates }
>

/** The release check: the daily switch, the running version, and what the last check found. */
export const UpdatesSection = () => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
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
    queryKey: DESKTOP_QUERY_KEYS.updates,
    queryFn: async (): Promise<UpdateStatus> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.readUpdates })
      if (reply.type === DESKTOP_REPLIES.updates) return reply.status
      throw new Error(refusalText({ reply, fallback: UNREADABLE }))
    },
    retry: false,
  })

  /** Sends `request` and keeps the status main answers with; false when it answered otherwise. */
  const send = async ({
    request,
    fallback,
  }: {
    request: UpdateRequest
    fallback: string
  }): Promise<boolean> => {
    setRefusal('')
    const reply = await client.request(request)
    if (reply.type !== DESKTOP_REPLIES.updates) {
      setRefusal(refusalText({ reply, fallback }))
      return false
    }
    queryClient.setQueryData(DESKTOP_QUERY_KEYS.updates, reply.status)
    return true
  }

  const setEnabled = async (isEnabled: boolean) => {
    lastPick.current += 1
    const pick = lastPick.current
    setPicked(isEnabled)
    await send({
      request: { type: DESKTOP_REQUESTS.setUpdateCheck, isEnabled },
      fallback: UNCHANGED,
    })
    if (pick === lastPick.current) setPicked(null)
  }

  const checkNow = async () => {
    if (isCheckingNow.current) return
    isCheckingNow.current = true
    setIsChecking(true)
    const isAnswered = await send({
      request: { type: DESKTOP_REQUESTS.checkForUpdates },
      fallback: UNCHECKED,
    })
    isCheckingNow.current = false
    setIsChecking(false)
    if (!isAnswered) return
    setHasJustChecked(true)
    setRound((current) => current + 1)
  }

  const openRelease = async () => {
    setRefusal('')
    const reply = await client.request({ type: DESKTOP_REQUESTS.openRelease })
    if (reply.type === DESKTOP_REPLIES.done) return
    setRefusal(refusalText({ reply, fallback: UNOPENED }))
  }

  const status = read.data ?? null
  const results = status === null ? [] : resultsOf({ status, hasJustChecked })

  return (
    <Section
      icon="rescan"
      title="Updates"
      help="raven player asks GitHub for its newest release and sends nothing else. It never installs one by itself."
    >
      {read.isError && (
        <p className={settings.error} role="alert">
          {read.error.message}
        </p>
      )}
      {status !== null && (
        <label className={settings.choice}>
          <input
            type="checkbox"
            checked={picked ?? status.isEnabled}
            aria-describedby={hintId}
            onChange={(event) => handled(setEnabled(event.target.checked))}
          />
          <span className={settings.choiceLabel}>Check for updates once a day</span>
          <span id={hintId} className={settings.choiceHint}>
            {`This is raven player ${status.current}. ${
              status.checkedAt === null
                ? 'Not checked yet.'
                : `Last checked ${new Date(status.checkedAt).toLocaleString()}.`
            }`}
          </span>
        </label>
      )}
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output className={styles.said}>
        {results.length > 0 && (
          <span key={round} className={styles.lines}>
            {results.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        )}
      </output>
      {status !== null && (
        <div className={styles.buttons}>
          {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
          <Button aria-disabled={isChecking} onClick={() => handled(checkNow())}>
            Check now
          </Button>
          {status.latest !== null && (
            <Button tone="primary" onClick={() => handled(openRelease())}>
              See what's new
            </Button>
          )}
        </div>
      )}
      {refusal !== '' && (
        <p className={settings.error} role="alert">
          {refusal}
        </p>
      )}
    </Section>
  )
}
