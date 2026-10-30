import { DESKTOP_REQUESTS, KEYS } from '@raven/core'
import { Button } from '@raven/ui'
import {
  type ComponentType,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { handled } from '@/desktop/handled'
import { useChangeDownloads, useDownloads, useSpace } from '@/desktop/downloadsApi'
import { DOWNLOADS_SECTION_COPY } from '@/desktop/settings/copy'
import { Section } from '@/desktop/settings/Section'
import { useComputerName } from '@/stores/desktop'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Whether the section asks before deleting every download, or offers to. */
const ASK_STATES = { idle: 'idle', asking: 'asking' } as const

type AskState = (typeof ASK_STATES)[keyof typeof ASK_STATES]

type ButtonRef = RefObject<HTMLButtonElement | null>

type DeleteAllViewProps = {
  question: string
  questionId: string
  isDeleting: boolean
  hasDownloads: boolean
  askButton: ButtonRef
  showButton: ButtonRef
  cancelButton: ButtonRef
  onDeleteAll: () => void
  onAsk: () => void
  onBack: () => void
  onBackKey: (event: KeyboardEvent) => void
  onShow: () => void
}

type DeleteAllQuestionProps = DeleteAllViewProps

const DeleteAllQuestion = ({
  question,
  questionId,
  isDeleting,
  cancelButton,
  onDeleteAll,
  onBack,
  onBackKey,
}: DeleteAllQuestionProps) => (
  <div className={styles.confirm}>
    <p id={questionId} className={styles.question}>
      {question}
    </p>
    <div className={`${styles.buttons} ${styles.answers}`}>
      {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
      <Button
        tone="danger"
        aria-describedby={questionId}
        aria-disabled={isDeleting}
        onClick={onDeleteAll}
        onKeyDown={onBackKey}
      >
        {DOWNLOADS_SECTION_COPY.deleteAll}
      </Button>
      <Button ref={cancelButton} onClick={onBack} onKeyDown={onBackKey}>
        {COMMON_COPY.cancel}
      </Button>
    </div>
  </div>
)

type DownloadsButtonsProps = DeleteAllViewProps

const DownloadsButtons = ({
  hasDownloads,
  askButton,
  showButton,
  onAsk,
  onShow,
}: DownloadsButtonsProps) => (
  <div className={styles.buttons}>
    <Button ref={showButton} icon="folder" onClick={onShow}>
      {DOWNLOADS_SECTION_COPY.showInFinder}
    </Button>
    <Button ref={askButton} tone="danger" icon="trash" disabled={!hasDownloads} onClick={onAsk}>
      {DOWNLOADS_SECTION_COPY.deleteAllDownloads}
    </Button>
  </div>
)

const DELETE_ALL_VIEWS = {
  [ASK_STATES.idle]: DownloadsButtons,
  [ASK_STATES.asking]: DeleteAllQuestion,
} as const satisfies Record<AskState, ComponentType<DeleteAllViewProps>>

/** What a new download starts with, the room downloads take, where they are, and deleting them all. */
export const DownloadsSection = () => {
  const downloads = useDownloads()
  const space = useSpace()
  const computer = useComputerName()
  const change = useChangeDownloads()
  const askButton = useRef<HTMLButtonElement>(null)
  const showButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)
  const questionId = useId()
  const [isAsking, setIsAsking] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDeletingNow = useRef(false)

  const data = downloads.data ?? null
  const hasDownloads = (data?.downloads.length ?? 0) > 0
  const used = space.data?.used ?? null

  // Focus follows the swap: into the question, then back to the button that asked, or beside it
  // once nothing is left to delete.
  useEffect(() => {
    const was = wasAsking.current
    wasAsking.current = isAsking
    if (isAsking) return cancelButton.current?.focus()
    if (!was) return
    const asker = askButton.current
    if (asker !== null && !asker.disabled) return asker.focus()
    showButton.current?.focus()
  }, [isAsking])

  const deleteAll = async () => {
    if (isDeletingNow.current) return
    isDeletingNow.current = true
    setIsDeleting(true)
    await change({ type: DESKTOP_REQUESTS.deleteAllDownloads })
    isDeletingNow.current = false
    setIsDeleting(false)
    setIsAsking(false)
  }

  const backOnEscape = (event: KeyboardEvent) => {
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    setIsAsking(false)
  }

  const question =
    used === null
      ? DOWNLOADS_SECTION_COPY.deleteAllQuestion
      : DOWNLOADS_SECTION_COPY.deleteAllFreeing(used)
  const DeleteAllView = DELETE_ALL_VIEWS[isAsking ? ASK_STATES.asking : ASK_STATES.idle]

  return (
    <Section
      icon="download"
      title={COMMON_COPY.downloads}
      help={DOWNLOADS_SECTION_COPY.help(computer)}
    >
      {downloads.isError && (
        <p className={settings.error} role="alert">
          {downloads.error.message}
        </p>
      )}
      {data !== null && (
        <label className={settings.choice}>
          <input
            type="checkbox"
            checked={data.shouldAutoDelete}
            onChange={(event) =>
              handled(
                change({
                  type: DESKTOP_REQUESTS.setDownloadDefaults,
                  shouldAutoDelete: event.target.checked,
                }),
              )
            }
          />
          <span className={settings.choiceLabel}>{COMMON_COPY.deleteOnceWatched}</span>
          <span className={settings.choiceHint}>
            {DOWNLOADS_SECTION_COPY.deleteOnceWatchedHint}
          </span>
        </label>
      )}
      {space.data !== undefined && (
        <p className={settings.hint}>
          {DOWNLOADS_SECTION_COPY.space({
            used: space.data.used,
            free: space.data.free,
            computer,
          })}
        </p>
      )}
      <DeleteAllView
        question={question}
        questionId={questionId}
        isDeleting={isDeleting}
        hasDownloads={hasDownloads}
        askButton={askButton}
        showButton={showButton}
        cancelButton={cancelButton}
        onDeleteAll={() => handled(deleteAll())}
        onAsk={() => setIsAsking(true)}
        onBack={() => setIsAsking(false)}
        onBackKey={backOnEscape}
        onShow={() => handled(change({ type: DESKTOP_REQUESTS.showDownloadsFolder }))}
      />
    </Section>
  )
}
