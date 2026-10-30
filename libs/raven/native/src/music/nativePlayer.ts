import type { AudioItem, AudioPlayer } from '@raven/audio'
import type { Track } from '@raven/core'
import type { WindowedPlayer } from '@raven/ui/headless'

type NativePlayerOfProps = {
  audio: Pick<
    AudioPlayer,
    'setWindow' | 'setNext' | 'play' | 'pause' | 'seekTo' | 'setVolume' | 'stop'
  >
  /** The track as the player takes it, with its ticketed address; rejects with why it cannot. */
  itemOf: (track: Track) => Promise<AudioItem>
}

type Step = (isCurrent: () => boolean) => Promise<void>

type EnqueueProps = {
  /** Whether this step replaces what the player holds, so the steps queued before it lapse. */
  isReplacing: boolean
  step: Step
}

/**
 * `@raven/audio` as the shared windowed host drives it. Each track needs a ticket first, so the
 * window's changes run one after another in the order asked, and a newer load or stop makes the
 * older ones lapse, so a slow ticket never lands a track the queue has moved past. Play and pause
 * go straight to the player, and the next window takes whichever was asked last.
 */
export const nativePlayerOf = ({ audio, itemOf }: NativePlayerOfProps): WindowedPlayer => {
  let generation = 0
  let chain: Promise<void> = Promise.resolve()
  let shouldPlay = true

  const enqueue = ({ isReplacing, step }: EnqueueProps): Promise<void> => {
    if (isReplacing) generation += 1
    const mine = generation
    const isCurrent = () => mine === generation
    const run = chain.then(() => (isCurrent() ? step(isCurrent) : undefined))
    chain = run.catch(() => undefined)
    return run
  }

  const nextItemOf = (next: Track | null): Promise<AudioItem | null> =>
    next === null ? Promise.resolve(null) : itemOf(next).catch(() => null)

  return {
    load: ({ playing, next, start }) =>
      enqueue({
        isReplacing: true,
        step: async (isCurrent) => {
          const [item, nextItem] = await Promise.all([itemOf(playing), nextItemOf(next)])
          if (!isCurrent()) return
          await audio.setWindow({ playing: item, next: nextItem, shouldPlay, start })
        },
      }),
    queueNext: (next) =>
      enqueue({
        isReplacing: false,
        step: async (isCurrent) => {
          const item = await nextItemOf(next)
          if (!isCurrent()) return
          await audio.setNext(item)
        },
      }),
    stop: () => enqueue({ isReplacing: true, step: () => audio.stop() }),
    setPlaying: ({ shouldPlay: isOn }) => {
      shouldPlay = isOn
      return isOn ? audio.play() : audio.pause()
    },
    seek: (seconds) => audio.seekTo(seconds),
    setVolume: ({ volume, isMuted }) => audio.setVolume(isMuted ? 0 : volume),
  }
}
