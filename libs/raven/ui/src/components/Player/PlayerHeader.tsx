import { type MediaItem, formatDuration } from '@raven/core'
import { useState } from 'react'
import { BUTTON_TONES, Button, ButtonLink } from '@/components/Button/Button'
import { STAGE_COPY } from '@/components/Player/copy'
import { aboutLine, headerTitleOf } from '@/components/Player/playbackFacts'
import styles from '@/components/Player/Player.module.scss'
import { PlayerStatus } from '@/components/Player/PlayerStatus'
import type { Rendition } from '@/components/Player/rendition'
import { TitleHeading } from '@/components/Player/TitleHeading'
import { useDocumentTitle } from '@/components/Player/useDocumentTitle'
import { classNames } from '@/lib/classNames'
import { useHostServices } from '@/stores/playerServices'

type PlayerHeaderProps = {
  isShown: boolean
  /** The library file playing; null for a local file. */
  media: MediaItem | null
  rendition: Rendition
  duration: number | null
  /** Where the title resumed, while the notice shows; null once it has gone. */
  resumedAt: number | null
  onBack: () => void
  onStartOver: () => void
}

/**
 * The top bar: the way back, the title (its art where it has some) and the line under it, how
 * it plays and what plays next, and the resume notice with its Start over.
 */
export const PlayerHeader = ({
  isShown,
  media,
  rendition,
  duration,
  resumedAt,
  onBack,
  onStartOver,
}: PlayerHeaderProps) => {
  const title = useHostServices((services) => services.title)
  const { label } = title
  useDocumentTitle(label)
  // A logo that fails to load gives way to the label for the rest of the title.
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const logo = title.logo !== null && title.logo.url !== failedLogo ? title.logo : null
  const heading = headerTitleOf({ media, label })
  // The art spells out only the name, so the line under it gives the year the label would.
  const about = aboutLine({ media, label: logo?.name ?? label, context: title.context, duration })
  const { next } = title
  return (
    <header className={classNames([styles.chrome, !isShown && styles.chromeHidden])}>
      <Button
        tone={BUTTON_TONES.ghost}
        icon="back"
        aria-label={STAGE_COPY.back}
        className={styles.back}
        onClick={onBack}
      />
      <div className={styles.heading}>
        <TitleHeading
          name={heading.name}
          logo={logo}
          homeTo={title.homeTo}
          onFail={setFailedLogo}
        />
        {heading.episode !== null && <p className={styles.episode}>{heading.episode}</p>}
        {!!about && <p className={styles.about}>{about}</p>}
      </div>
      <PlayerStatus media={media} mode={rendition.mode} quality={rendition.quality}>
        {next && (
          <ButtonLink
            to={next.to}
            state={next.state}
            replace
            tone={BUTTON_TONES.ghost}
            icon={next.isShuffled ? 'shuffle' : 'next'}
            className={styles.next}
            aria-label={STAGE_COPY.upNextLabel(next.label)}
            title={next.label}
          >
            <span className={styles.nextLead}>{STAGE_COPY.upNext}</span>
            <span className={styles.nextLabel}>{next.label}</span>
          </ButtonLink>
        )}
      </PlayerStatus>
      {resumedAt !== null && (
        <p className={styles.resumed} aria-live="polite">
          <span>{STAGE_COPY.resumedAt(formatDuration(resumedAt))}</span>
          <Button tone={BUTTON_TONES.ghost} className={styles.startOver} onClick={onStartOver}>
            {STAGE_COPY.startOver}
          </Button>
        </p>
      )}
    </header>
  )
}
