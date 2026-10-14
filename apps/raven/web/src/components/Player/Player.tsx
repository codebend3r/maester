import type { MediaItem } from '@raven/core'
import styles from '@/components/Player/Player.module.scss'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { useLeave } from '@/components/Player/useLeave'
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
export const Player = ({
  media,
  upNext,
  backTo,
}: {
  media: MediaItem
  /** What plays after this video ends, in turn. */
  upNext: readonly MediaItem[]
  /** Where Back goes when no page of the app opened the player; otherwise it goes back to that page. */
  backTo: string
}) => {
  const leave = useLeave(backTo)
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
          onBack={leave}
          problems={playback.problems}
          onTryAnyway={playback.tryAnyway}
        />
      )
    case 'playing':
      if (selection.isWaitingForTracks) return <Waiting />
      return (
        <Stage
          media={media}
          upNext={upNext}
          onBack={leave}
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
