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
import { UPDATES_SECTION_COPY } from '@/desktop/settings/copy'
import { Section } from '@/desktop/settings/Section'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'

type CheckedLineProps = Pick<UpdateStatus, 'current' | 'checkedAt'>

/** The running version, and when its release check last ran. */
const checkedLine = ({ current, checkedAt }: CheckedLineProps): string => {
  const checked =
    checkedAt === null
      ? UPDATES_SECTION_COPY.notChecked
      : UPDATES_SECTION_COPY.lastChecked(new Date(checkedAt).toLocaleString())
  return `${UPDATES_SECTION_COPY.version(current)} ${checked}`
}

type ResultsOfProps = {
  status: UpdateStatus
  hasJustChecked: boolean
}

/** The result lines a status holds; "newest" only from a check this visit just ran. */
const resultsOf = ({ status, hasJustChecked }: ResultsOfProps): string[] => {
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
      throw new Error(refusalText({ reply, fallback: UPDATES_SECTION_COPY.unreadable }))
    },
    retry: false,
  })

  type SendProps = {
    request: UpdateRequest
    fallback: string
  }

  /** Sends `request` and keeps the status main answers with; false when it answered otherwise. */
  const send = async ({ request, fallback }: SendProps): Promise<boolean> => {
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
      fallback: UPDATES_SECTION_COPY.unchanged,
    })
    if (pick === lastPick.current) setPicked(null)
  }

  const checkNow = async () => {
    if (isCheckingNow.current) return
    isCheckingNow.current = true
    setIsChecking(true)
    const isAnswered = await send({
      request: { type: DESKTOP_REQUESTS.checkForUpdates },
      fallback: UPDATES_SECTION_COPY.unchecked,
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
    setRefusal(refusalText({ reply, fallback: UPDATES_SECTION_COPY.unopened }))
  }

  const status = read.data ?? null
  const results = status === null ? [] : resultsOf({ status, hasJustChecked })

  return (
    <Section icon="rescan" title={UPDATES_SECTION_COPY.title} help={UPDATES_SECTION_COPY.help}>
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
          <span className={settings.choiceLabel}>{UPDATES_SECTION_COPY.checkDaily}</span>
          <span id={hintId} className={settings.choiceHint}>
            {checkedLine(status)}
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
            {UPDATES_SECTION_COPY.checkNow}
          </Button>
          {status.latest !== null && (
            <Button tone="primary" onClick={() => handled(openRelease())}>
              {UPDATES_SECTION_COPY.whatsNew}
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
