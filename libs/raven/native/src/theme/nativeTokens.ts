/** React Native's lengths are points, which the web's rem is sixteen of. */
const POINTS_PER_REM = 16

const REM = /^(-?\d*\.?\d+)rem$/
const PIXELS = /^(-?\d*\.?\d+)px$/
const NUMBER = /^-?\d*\.?\d+$/
const HEX_COLOUR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const TRANSLUCENT_RGB = /^rgb\((\d{1,3}) (\d{1,3}) (\d{1,3}) \/ (\d*\.?\d+)%\)$/

/** A colour as React Native takes it: hex as written, CSS's `rgb(r g b / a%)` as `rgba()`. */
const colourOf = (value: string): string | null => {
  if (HEX_COLOUR.test(value)) return value
  const [, red, green, blue, alpha] = TRANSLUCENT_RGB.exec(value) ?? []
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined)
    return null
  return `rgba(${red}, ${green}, ${blue}, ${Number(alpha) / 100})`
}

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
 * as written, a translucent `rgb()` as `rgba()`, and lengths and plain numbers
 * as numbers. What it has no way to say (`clamp()`, `var()`, `color-mix()`, a
 * gradient, a shadow, a font stack, an em) is dropped rather than guessed at.
 */
export const nativeTokens = (tokens: Readonly<Record<string, string>>): NativeTokens =>
  Object.entries(tokens).reduce<NativeTokens>(
    ({ colours, numbers }, [name, value]) => {
      const colour = colourOf(value)
      if (colour !== null) return { colours: { ...colours, [name]: colour }, numbers }
      const number = numberOf(value)
      if (number === null) return { colours, numbers }
      return { colours, numbers: { ...numbers, [name]: number } }
    },
    { colours: {}, numbers: {} },
  )
