import { KEYS } from '@raven/core'
import { BUTTON_TONES, Button } from '@raven/ui'
import { type KeyboardEvent, useId, useState } from 'react'
import { DOWNLOAD_BUTTON_COPY } from '@/components/DownloadButton/copy'
import { COMMON_COPY } from '@/lib/copy'
import { useDownloadNotes } from '@/stores/downloadNotes'
import styles from '@/components/DownloadButton/DolbyVisionNote.module.scss'

/**
 * Download, greyed out, for a Dolby Vision only title where the page's host keeps none: a browser
 * that does not play Dolby Vision. The note that says so opens by itself the first time one is
 * met, until Got it answers it; after that the button opens and closes it. The button is
 * `aria-disabled`, not `disabled`, so it keeps its focus and still says why.
 */
export const UnsupportedDownloadButton = () => {
  const ids = { note: useId(), title: useId() }
  const hasSeen = useDownloadNotes((state) => state.hasSeenDolbyVision)
  const see = useDownloadNotes((state) => state.seeDolbyVision)
  const [isOpen, setIsOpen] = useState(!hasSeen)

  const close = () => {
    setIsOpen(false)
    see()
  }

  // Escape closes the note from either button, the only places focus can be.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === KEYS.escape && isOpen) close()
  }

  return (
    <span className={styles.control} data-wide>
      <Button
        icon="download"
        className={styles.greyed}
        aria-disabled
        aria-expanded={isOpen}
        aria-controls={ids.note}
        aria-describedby={isOpen ? ids.note : undefined}
        title={DOWNLOAD_BUTTON_COPY.dolbyVision.title}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        onKeyDown={onKeyDown}
      >
        {COMMON_COPY.download}
      </Button>
      {isOpen && (
        <span id={ids.note} className={styles.note} role="note" aria-labelledby={ids.title}>
          <strong id={ids.title}>{DOWNLOAD_BUTTON_COPY.dolbyVision.title}</strong>
          <span>{DOWNLOAD_BUTTON_COPY.dolbyVision.why}</span>
          <Button tone={BUTTON_TONES.ghost} onClick={close} onKeyDown={onKeyDown}>
            {DOWNLOAD_BUTTON_COPY.dolbyVision.dismiss}
          </Button>
        </span>
      )}
    </span>
  )
}
