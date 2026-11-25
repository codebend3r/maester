import { BUTTON_TONES, Button } from '@raven/ui'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import type { ComponentProps } from 'react'
import { TRANSPORT_COPY } from '@/components/Transport/copy'
import { COMMON_COPY } from '@/lib/copy'

type TransportProps = {
  className: string
  /** How large play or pause stands between the skips. */
  playSize?: ComponentProps<typeof Button>['size']
}

/** Previous, play or pause, next: what moves the queue, wherever the player shows. */
export const Transport = ({ className, playSize }: TransportProps) => {
  const state = useAudioQueue((store) => store.state)
  const toggle = useAudioQueue((store) => store.toggle)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  return (
    <div className={className}>
      <Button
        tone={BUTTON_TONES.ghost}
        icon="skipPrevious"
        aria-label={TRANSPORT_COPY.previousTrack}
        onClick={skipPrevious}
      />
      <Button
        tone={BUTTON_TONES.primary}
        size={playSize}
        icon={isPlaying ? 'pause' : 'play'}
        aria-label={isPlaying ? COMMON_COPY.pause : COMMON_COPY.play}
        onClick={toggle}
      />
      <Button
        tone={BUTTON_TONES.ghost}
        icon="skipNext"
        aria-label={TRANSPORT_COPY.nextTrack}
        onClick={skipNext}
      />
    </div>
  )
}
