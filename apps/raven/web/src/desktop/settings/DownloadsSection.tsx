import { DESKTOP_REQUESTS, formatBytes, KEYS } from '@raven/core'
import { Button } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { handled } from '@/desktop/handled'
import { useChangeDownloads, useDownloads, useSpace } from '@/desktop/downloadsApi'
import { Section } from '@/desktop/settings/Section'
import styles from '@/desktop/settings/DesktopSettings.module.scss'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'

/** What a new download starts with, the room downloads take, where they are, and deleting them all. */
export const DownloadsSection = () => {
  const downloads = useDownloads()
  const space = useSpace()
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
      ? 'Delete all downloads?'
      : `Delete all downloads? ${formatBytes(used)} will be freed.`

  return (
    <Section icon="download" title="Downloads" help="What Raven keeps on this Mac.">
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
          <span className={settings.choiceLabel}>Delete once watched</span>
          <span className={settings.choiceHint}>
            What a new download starts with. A download set so goes a while after its last minutes
            play.
          </span>
        </label>
      )}
      {space.data !== undefined && (
        <p className={settings.hint}>
          {`${formatBytes(space.data.used)} of downloads, ${formatBytes(space.data.free)} free on this Mac.`}
        </p>
      )}
      {isAsking ? (
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
              onClick={() => handled(deleteAll())}
              onKeyDown={backOnEscape}
            >
              Delete all
            </Button>
            <Button ref={cancelButton} onClick={() => setIsAsking(false)} onKeyDown={backOnEscape}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.buttons}>
          <Button
            ref={showButton}
            icon="folder"
            onClick={() => handled(change({ type: DESKTOP_REQUESTS.showDownloadsFolder }))}
          >
            Show in Finder
          </Button>
          <Button
            ref={askButton}
            tone="danger"
            icon="trash"
            disabled={!hasDownloads}
            onClick={() => setIsAsking(true)}
          >
            Delete all downloads
          </Button>
        </div>
      )}
    </Section>
  )
}
