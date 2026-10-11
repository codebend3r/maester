import type { MediaItem } from '@raven/core'
import { useState } from 'react'
import { Button, ButtonLink } from '@/components/Button/Button'
import styles from '@/components/Player/Player.module.scss'
import { api } from '@/lib/api'

/**
 * What stands in for the video when nothing this browser and server can do
 * together will play it: no way to convert, or every way tried and failed.
 * The way forward is another browser or a desktop player pointed at the
 * same URL.
 */
export const Unplayable = ({
  media,
  problems,
  backTo,
  onTryAnyway,
}: {
  media: MediaItem
  problems: string[]
  backTo: string
  onTryAnyway: (() => void) | null
}) => {
  const [copied, setCopied] = useState<string | null>(null)
  const thumbnail = api.thumbnailUrl(media)

  const copyLink = () => {
    const link = new URL(api.fileUrl(media.id), window.location.origin).href
    navigator.clipboard.writeText(link).then(
      () => setCopied('Link copied. Paste it into VLC or IINA to play it there.'),
      () => setCopied(`Copy this link: ${link}`),
    )
  }

  return (
    <section className={styles.unplayable} aria-labelledby="unplayable-title">
      {!!thumbnail && <img className={styles.backdrop} src={thumbnail} alt="" aria-hidden="true" />}
      <div className={styles.panel}>
        <ButtonLink to={backTo} icon="back" className={styles.panelBack}>
          Library
        </ButtonLink>
        <h1 id="unplayable-title" className={styles.panelTitle}>
          {media.title}
        </h1>
        <p>This video can't play in this browser.</p>
        <ul className={styles.problems}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p className={styles.hint}>
          The file is served untouched, so a player that handles every format, like VLC or IINA, can
          open the same link.
        </p>
        <div className={styles.panelActions}>
          {!!onTryAnyway && (
            <Button tone="primary" onClick={onTryAnyway}>
              Try playing anyway
            </Button>
          )}
          <Button icon="copy" onClick={copyLink}>
            Copy file link
          </Button>
        </div>
        <p className={styles.hint} aria-live="polite">
          {copied}
        </p>
      </div>
    </section>
  )
}
