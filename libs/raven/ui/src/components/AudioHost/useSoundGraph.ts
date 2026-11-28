import type { EqGains } from '@raven/core'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { type SoundGraph, soundGraph } from '@/components/AudioHost/soundGraph'
import { useSoundMeter } from '@/stores/soundMeter'

/** The `AudioContext` state a browser holds a context in until a gesture lets it run. */
const SUSPENDED: AudioContextState = 'suspended'

/** The gestures a browser lets a suspended context resume on. */
const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const

/** Whether this browser has Web Audio at all. */
export const hasWebAudio = (): boolean => typeof AudioContext !== 'undefined'

type Routed = {
  context: AudioContext
  graph: SoundGraph
  /** Lets go of the meter this graph claimed, unless another engine has taken it since. */
  releaseMeter: () => void
}

type UseSoundGraphProps = {
  elements: readonly RefObject<HTMLAudioElement | null>[]
  gains: EqGains
}

type SoundRoute = {
  /** The graph, once a play has built it; null until then, and where the browser has no Web Audio. */
  graph: () => SoundGraph | null
  /** Builds the graph on the first play that needs it, and resumes a context the browser suspended. */
  wake: () => void
}

/**
 * The host's one `AudioContext` and graph. It is built on a play, not on
 * mount, since a browser keeps a context made before a gesture suspended,
 * and each element is routed once, as `createMediaElementSource` allows.
 * Once built, its levels are what `useSoundMeter` reads, until the host goes.
 */
export const useSoundGraph = ({ elements, gains }: UseSoundGraphProps): SoundRoute => {
  const routed = useRef<Routed | null>(null)
  // Read when the graph is built, which happens in a play rather than when the gains change.
  const latestGains = useRef(gains)

  useEffect(() => {
    latestGains.current = gains
    routed.current?.graph.setEq(gains)
  }, [gains])

  useEffect(
    () => () => {
      const current = routed.current
      routed.current = null
      if (current === null) return
      current.context.close().catch(() => undefined)
      current.releaseMeter()
    },
    [],
  )

  /*
   * A graph a play built with no gesture behind it (a media key, an advance, a fade) stays
   * suspended, its elements playing into silence, until the next gesture resumes it.
   */
  useEffect(() => {
    if (!hasWebAudio()) return
    const resume = () => {
      const context = routed.current?.context
      if (context?.state === SUSPENDED) context.resume().catch(() => undefined)
    }
    GESTURE_EVENTS.forEach((name) => document.addEventListener(name, resume, { capture: true }))
    return () =>
      GESTURE_EVENTS.forEach((name) =>
        document.removeEventListener(name, resume, { capture: true }),
      )
  }, [])

  const graph = useCallback(() => routed.current?.graph ?? null, [])

  const wake = useCallback(() => {
    if (!hasWebAudio()) return
    const build = (): Routed | null => {
      const nodes = elements.flatMap((ref) => (ref.current ? [ref.current] : []))
      if (nodes.length !== elements.length) return null
      const context = new AudioContext()
      const built = soundGraph({ context, elements: nodes })
      built.setEq(latestGains.current)
      const releaseMeter = useSoundMeter.getState().claim(built.levels)
      routed.current = { context, graph: built, releaseMeter }
      return routed.current
    }
    const current = routed.current ?? build()
    if (current?.context.state !== SUSPENDED) return
    current.context.resume().catch(() => undefined)
  }, [elements])

  return { graph, wake }
}
