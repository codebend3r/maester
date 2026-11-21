import { useState } from 'react'
import type { TokenStyle } from '@/theme/tokens'
import styles from '@/player/Adjuster/Adjuster.module.scss'

type AdjusterProps = {
  label: string
  /** Where it stands, from 0 to `max`. */
  value: number
  max: number
  /** How far an arrow key moves it. */
  step: number
  /** What it is said to stand at: "1:02 of 4:44", "80%". */
  valueText: (value: number) => string
  /** Called once, as the pointer lets go or a key lands, with where it was left. */
  onChange: (value: number) => void
}

/**
 * A line a pointer sets by pressing or sliding along it, the part up to its value filled and a
 * round thumb where it stands: the scrubber and the volume. It is the browser's own range, so
 * the arrow keys move it a `step` at a time and a screen reader reads `valueText`. A slide is
 * shown as it goes and told once, where it ends, as the apps' is; a key is told at once.
 */
export function Adjuster({ label, value, max, step, valueText, onChange }: AdjusterProps) {
  // Where the pointer holds it, shown in place of `value` until it lets go.
  const [held, setHeld] = useState<number | null>(null)
  const [isSliding, setIsSliding] = useState(false)
  const shown = Math.min(max, Math.max(0, held ?? value))
  const filled: TokenStyle = { '--filled': `${max > 0 ? (shown / max) * 100 : 0}%` }
  const move = (to: number) => {
    if (isSliding) {
      setHeld(to)
      return
    }
    onChange(to)
  }
  const letGo = () => {
    setIsSliding(false)
    if (held === null) return
    setHeld(null)
    onChange(held)
  }
  return (
    <input
      aria-label={label}
      aria-valuetext={valueText(shown)}
      className={styles.adjuster}
      max={max}
      min={0}
      onChange={(event) => move(Number(event.target.value))}
      onPointerCancel={letGo}
      onPointerDown={() => setIsSliding(true)}
      onPointerUp={letGo}
      step={step}
      style={filled}
      type="range"
      value={shown}
    />
  )
}
