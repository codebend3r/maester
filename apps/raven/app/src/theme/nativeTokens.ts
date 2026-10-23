/** React Native's lengths are points, which the web's rem is sixteen of. */
const POINTS_PER_REM = 16

const REM = /^(-?\d*\.?\d+)rem$/
const PIXELS = /^(-?\d*\.?\d+)px$/
const NUMBER = /^-?\d*\.?\d+$/
const HEX_COLOUR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i

/** A length in points or a plain number; null for anything else. */
const numberOf = (value: string): number | null => {
  const rem = REM.exec(value)?.[1] ?? null
  if (rem !== null) return Number(rem) * POINTS_PER_REM
  const pixels = PIXELS.exec(value)?.[1] ?? null
  if (pixels !== null) return Number(pixels)
  return NUMBER.test(value) ? Number(value) : null
}

type NativeTokens = { colours: Record<string, string>; numbers: Record<string, number> }

/**
 * The web's custom properties that React Native can use, by name: hex colours
 * as written, and lengths and plain numbers as numbers. What it has no way to
 * say (`clamp()`, `var()`, `color-mix()`, `rgb()` with a percent alpha, a
 * shadow, a font stack, an em) is dropped rather than guessed at.
 */
export const nativeTokens = (tokens: Readonly<Record<string, string>>): NativeTokens =>
  Object.entries(tokens).reduce<NativeTokens>(
    ({ colours, numbers }, [name, value]) => {
      if (HEX_COLOUR.test(value)) return { colours: { ...colours, [name]: value }, numbers }
      const number = numberOf(value)
      if (number === null) return { colours, numbers }
      return { colours, numbers: { ...numbers, [name]: number } }
    },
    { colours: {}, numbers: {} },
  )
