/** One of the interface's own sounds: a short, quiet glide from one pitch to another, in hertz. */
export type Blip = { from: number; to: number }

/** The sounds the interface makes: a rise as something opens, a fall as it folds away. */
export const BLIPS = {
  open: { from: 420, to: 760 },
  close: { from: 620, to: 340 },
} as const satisfies Record<string, Blip>

/** How long a blip lasts, and how soon it reaches its loudest, in seconds. */
const BLIP_SECONDS = 0.11
const BLIP_ATTACK_SECONDS = 0.015

/** A blip's loudest, well under a track's, and the near-silence it rises from and falls to. */
const BLIP_LEVEL = 0.05
const BLIP_SILENCE = 0.0001

const BLIP_WAVE: OscillatorType = 'sine'

const RUNNING: AudioContextState = 'running'

let shared: AudioContext | null = null

/** The one context every blip plays through, made on the first; none where a browser has no Web Audio. */
const contextOf = (): AudioContext | null => {
  if (typeof AudioContext === 'undefined') return null
  shared ??= new AudioContext()
  return shared
}

type PlayBlipProps = { blip: Blip }

/**
 * Plays `blip` now. A browser lets no page sound before its viewer has
 * clicked or typed in it, so until then the context waits and the blip is
 * dropped, never queued: a sound that arrives late says nothing.
 */
export const playBlip = ({ blip }: PlayBlipProps): void => {
  const context = contextOf()
  if (!context) return
  if (context.state !== RUNNING) {
    context.resume().catch(() => undefined)
    return
  }
  const at = context.currentTime
  const end = at + BLIP_SECONDS
  const oscillator = context.createOscillator()
  const level = context.createGain()
  oscillator.type = BLIP_WAVE
  oscillator.frequency.setValueAtTime(blip.from, at)
  oscillator.frequency.exponentialRampToValueAtTime(blip.to, end)
  level.gain.setValueAtTime(BLIP_SILENCE, at)
  level.gain.exponentialRampToValueAtTime(BLIP_LEVEL, at + BLIP_ATTACK_SECONDS)
  level.gain.exponentialRampToValueAtTime(BLIP_SILENCE, end)
  oscillator.connect(level).connect(context.destination)
  oscillator.start(at)
  oscillator.stop(end)
}
