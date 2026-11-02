import { type RefObject, useEffect, useState } from 'react'
import type { SoundGraph } from '@/components/AudioHost/soundGraph'
import { AUDIO_STATES, useAudioQueue } from '@/stores/audioQueue'

/** What an element last loaded: the track, and whether it was fetched with CORS, as Web Audio needs. */
type ElementLoad = { id: number; isCors: boolean }

/** What each element has loaded; an element that has nothing is missing. */
export type ElementLoads = WeakMap<HTMLMediaElement, ElementLoad>

/** The fade under way: the element the next track fades in on, by its place, and that track. */
type Fade = { slot: number; id: number }

/** A fade that ended: taken, once the queue reached its track, or stopped short. */
type Settled = { fade: Fade; isTaken: boolean }

type ElementRef = RefObject<HTMLAudioElement | null>

/** Puts an element back to its track's top, ready to fade in again. */
const rewind = (element: HTMLMediaElement): void => {
  element.currentTime = 0
}

type UseCrossfadeProps = {
  /** The host's two elements, which take turns to lead. */
  elements: readonly [ElementRef, ElementRef]
  trackId: number | null
  nextId: number | null
  /** How long a fade runs; 0 for none. */
  seconds: number
  graph: () => SoundGraph | null
  loads: RefObject<ElementLoads>
  play: (element: HTMLMediaElement) => void
}

export type Crossfade = {
  /** The place of the element that plays the queue's track. */
  lead: number
  /** Starts the fade into the next track once `element`, the lead, is within the fade of its end. */
  startIfDue: (element: HTMLMediaElement) => void
}

/**
 * Overlaps the end of one track with the start of the next: at `duration -
 * seconds` the element holding the preloaded next track starts, and the
 * graph ramps the two across. The queue moves on when the outgoing track
 * ends, as without a fade, so a track still ends and counts once; its
 * element then hands the lead to the one already playing. A pause, a seek
 * or a change of what comes next stops the incoming track, and the fade
 * starts again, shorter, should the lead play on into its last seconds.
 * With no next track (the queue's last, or repeat one) nothing fades.
 */
export const useCrossfade = ({
  elements,
  trackId,
  nextId,
  seconds,
  graph,
  loads,
  play,
}: UseCrossfadeProps): Crossfade => {
  const state = useAudioQueue((store) => store.state)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const [lead, setLead] = useState(0)
  const [fade, setFade] = useState<Fade | null>(null)
  const [settled, setSettled] = useState<Settled | null>(null)
  // Settled while rendering, so no effect of this render loads the track afresh on the element that led.
  if (fade !== null && fade.id === trackId) {
    setLead(fade.slot)
    setFade(null)
    setSettled({ fade, isTaken: true })
  } else if (
    fade !== null &&
    (fade.id !== nextId || state !== AUDIO_STATES.playing || seek !== null)
  ) {
    setFade(null)
    setSettled({ fade, isTaken: false })
  }

  useEffect(() => {
    if (settled === null) return
    const incoming = elements[settled.fade.slot]?.current ?? null
    const outgoing = elements[1 - settled.fade.slot]?.current ?? null
    if (!incoming || !outgoing) return
    if (!settled.isTaken) {
      incoming.pause()
      rewind(incoming)
      graph()?.crossfade({ from: incoming, to: outgoing, seconds: 0 })
      return
    }
    outgoing.pause()
    graph()?.crossfade({ from: outgoing, to: incoming, seconds: 0 })
    // It was playing before the queue reached its track, so it sends no `playing` of its own.
    engine.state(AUDIO_STATES.playing)
    engine.time({
      position: incoming.currentTime,
      duration: Number.isFinite(incoming.duration) ? incoming.duration : null,
    })
  }, [settled, elements, graph, engine])

  return {
    lead,
    startIfDue: (element) => {
      if (seconds <= 0 || fade !== null || nextId === null || state !== AUDIO_STATES.playing) {
        return
      }
      const route = graph()
      const slot = 1 - lead
      const incoming = elements[slot]?.current ?? null
      if (!route || !incoming || element !== elements[lead]?.current || element.ended) return
      const loaded = loads.current.get(incoming)
      if (loaded?.id !== nextId || !loaded.isCors) return
      const remaining = element.duration - element.currentTime
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > seconds) return
      rewind(incoming)
      play(incoming)
      route.crossfade({ from: element, to: incoming, seconds: remaining })
      setFade({ slot, id: nextId })
    },
  }
}
