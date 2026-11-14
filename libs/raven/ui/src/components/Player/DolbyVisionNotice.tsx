import { type ApiClient, type MediaItem } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { BUTTON_TONES, Button } from '@/components/Button/Button'
import { DOLBY_VISION_NOTICE_COPY } from '@/components/Player/copy'
import styles from '@/components/Player/DolbyVisionNotice.module.scss'
import { playerQueriesFor } from '@/lib/playerQueries'

type DolbyVisionNoticeProps = { api: ApiClient; media: MediaItem }

/**
 * Why a Dolby Vision profile 5 picture plays purple and green in the browser,
 * and where it plays true. Only an HDR file can be Dolby Vision, so no other
 * is probed for it. The video keeps playing under it, and it never takes
 * focus, so the keys work while it shows.
 */
export const DolbyVisionNotice = ({ api, media }: DolbyVisionNoticeProps) => {
  const heading = useId()
  const [isDismissed, setDismissed] = useState(false)
  const streams = useQuery({ ...playerQueriesFor(api).streams(media.id), enabled: media.hdr })
  const isShown = !isDismissed && (streams.data?.video?.isDolbyVisionOnly ?? false)
  return (
    isShown && (
      <div className={styles.layer}>
        <aside className={styles.notice} aria-labelledby={heading}>
          <h2 id={heading} className={styles.heading}>
            {DOLBY_VISION_NOTICE_COPY.heading}
          </h2>
          <div className={styles.body}>
            <p>{DOLBY_VISION_NOTICE_COPY.body}</p>
            <p>{DOLBY_VISION_NOTICE_COPY.advice}</p>
            {media.versions > 1 && <p>{DOLBY_VISION_NOTICE_COPY.otherVersions}</p>}
          </div>
          <Button
            tone={BUTTON_TONES.ghost}
            className={styles.dismiss}
            onClick={() => setDismissed(true)}
          >
            {DOLBY_VISION_NOTICE_COPY.dismiss}
          </Button>
        </aside>
      </div>
    )
  )
}
