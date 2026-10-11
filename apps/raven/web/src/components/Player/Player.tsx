import type { MediaItem } from '@raven/core'
import styles from '@/components/Player/Player.module.scss'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
import { useTrackSelection } from '@/components/Player/useTrackSelection'

/** The stage's spinner, while what picks the first source is still on its way. */
const Waiting = () => (
  <div className={styles.stage} aria-busy="true">
    <output className={styles.spinner} aria-label="Loading" />
  </div>
)

/**
 * Picks how to play a file and which tracks to play, then hands over to
 * the stage, or says why the file cannot play once every way has failed.
 */
export const Player = ({ media, backTo }: { media: MediaItem; backTo: string }) => {
  const selection = useTrackSelection(media.id)
  const playback = usePlaybackLadder({
    media,
    audio: selection.audio,
    isDefaultAudio: selection.isDefaultAudio,
  })
  switch (playback.status) {
    case 'waiting':
      return <Waiting />
    case 'unplayable':
      return (
        <Unplayable
          media={media}
          backTo={backTo}
          problems={playback.problems}
          onTryAnyway={playback.tryAnyway}
        />
      )
    case 'playing':
      if (selection.isWaitingForTracks) return <Waiting />
      return (
        <Stage
          media={media}
          backTo={backTo}
          mode={playback.mode}
          selection={selection}
          onFailure={playback.fail}
        />
      )
    default: {
      const unknown: never = playback
      return unknown
    }
  }
}
