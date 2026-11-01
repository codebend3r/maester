import { QUEUE_SOURCE_KINDS, type RadioSeed } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { useMutation } from '@tanstack/react-query'
import { START_RADIO_COPY } from '@/components/StartRadio/copy'
import { api } from '@/lib/api'

/** How the button shows: named in words, or its icon alone, named for what it starts from. */
export const START_RADIO_LOOKS = { words: 'words', icon: 'icon' } as const

type StartRadioLook = (typeof START_RADIO_LOOKS)[keyof typeof START_RADIO_LOOKS]

type UseStartRadioProps = { seed: RadioSeed }

/** Asks the server for a radio around `seed` and plays it, saying so when it cannot. */
const useStartRadio = ({ seed }: UseStartRadioProps) => {
  const playTracks = useAudioQueue((store) => store.playTracks)
  const showToast = useToasts((state) => state.show)
  return useMutation({
    mutationFn: () => api.getRadio({ seed }),
    onSuccess: (tracks) => {
      if (tracks.length === 0) return showToast(START_RADIO_COPY.nothingToPlay)
      playTracks({
        tracks,
        source: { kind: QUEUE_SOURCE_KINDS.radio, id: seed.id, seed: seed.kind },
      })
    },
    onError: (error) => showToast(START_RADIO_COPY.failed(error.message)),
  })
}

type StartRadioProps = {
  seed: RadioSeed
  /** What the radio starts from, read aloud on the icon alone. */
  title: string
  look?: StartRadioLook
}

/**
 * Start radio: up to 50 tracks around a track, an album or an artist, played
 * as a queue whose source is the radio and its seed.
 */
export const StartRadio = ({ seed, title, look = START_RADIO_LOOKS.words }: StartRadioProps) => {
  const radio = useStartRadio({ seed })
  const isIconOnly = look === START_RADIO_LOOKS.icon
  return (
    <Button
      tone={isIconOnly ? 'ghost' : 'quiet'}
      icon="headphones"
      aria-label={isIconOnly ? START_RADIO_COPY.startRadioFrom(title) : undefined}
      disabled={radio.isPending}
      onClick={() => radio.mutate()}
    >
      {!isIconOnly && START_RADIO_COPY.startRadio}
    </Button>
  )
}
