import { KEYS, formatBytes } from '@raven/core'
import { Button } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useChangeDownloads, useDownloads, useSpace } from '@/renderer/desktop/downloadsApi'
import styles from '@/renderer/SettingsPage/Downloads.module.scss'
import { DESKTOP_REQUESTS } from '@/shared/protocol'

const focus = (element: HTMLElement | null) => {
  if (element !== null) element.focus()
}

/** What a new download starts with, deleting every download, and where they are kept. */
export const Downloads = ({ className }: { className?: string }) => {
  const downloads = useDownloads()
  const space = useSpace()
  const change = useChangeDownloads()
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const askButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)
  const questionId = useId()
  const [isAsking, setIsAsking] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDeletingNow = useRef(false)

  const data = downloads.data ?? null
  const hasDownloads = (data?.downloads.length ?? 0) > 0

  // Focus follows the swap: into the question, then back to the button that asked, or to the
  // heading once nothing is left to delete, unless the person has moved on.
  useEffect(() => {
    const was = wasAsking.current
    wasAsking.current = isAsking
    if (isAsking) return focus(cancelButton.current)
    if (!was) return
    const active = document.activeElement
    const isFocusLost = active === null || active === document.body
    if (!isFocusLost && !(section.current?.contains(active) ?? false)) return
    const button = askButton.current
    focus(button !== null && !button.disabled ? button : heading.current)
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

  const used = space.data?.used ?? null
  const question =
    used === null
      ? 'Delete all downloads?'
      : `Delete all downloads? ${formatBytes(used)} will be freed.`

  return (
    <section
      ref={section}
      className={`${styles.downloads} ${className ?? ''}`}
      aria-labelledby="downloads-title"
    >
      <h2 id="downloads-title" tabIndex={-1} ref={heading}>
        Downloads
      </h2>
      {downloads.isError && <p>{downloads.error.message}</p>}
      {data !== null && (
        <label className={styles.choice}>
          <input
            type="checkbox"
            role="switch"
            checked={data.autoDeleteDefault}
            aria-checked={data.autoDeleteDefault}
            onChange={(event) =>
              void change({
                type: DESKTOP_REQUESTS.setDownloadDefaults,
                autoDelete: event.target.checked,
              })
            }
          />
          Delete once watched by default
        </label>
      )}
      {isAsking ? (
        <div className={styles.confirm}>
          <p id={questionId} className={styles.question}>
            {question}
          </p>
          <div className={styles.confirmActions}>
            {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
            <Button
              tone="danger"
              aria-describedby={questionId}
              aria-disabled={isDeleting}
              onClick={() => void deleteAll()}
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
        <Button
          ref={askButton}
          tone="danger"
          disabled={!hasDownloads}
          onClick={() => setIsAsking(true)}
        >
          Delete all downloads
        </Button>
      )}
      <div className={styles.folder}>
        <p className={styles.where}>Downloads are kept in raven player's data folder</p>
        <Button
          className={styles.show}
          icon="folder"
          onClick={() => void change({ type: DESKTOP_REQUESTS.showDownloadsFolder })}
        >
          Show in Finder
        </Button>
      </div>
    </section>
  )
}
