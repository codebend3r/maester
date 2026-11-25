import { describe, expect, it } from 'bun:test'
import { parseThemes } from '@raven/core'
import { THEME_SCHEMES, WREN_THEMES } from '@raven/wren'

const GLOBALS = new URL('./globals.scss', import.meta.url)

const APP_TOKENS = new URL('../../../../wren/wren-app/src/theme/wrenTokens.ts', import.meta.url)

const stylesheet = await Bun.file(GLOBALS).text()

const blocks = parseThemes(stylesheet)

const appTokens = await Bun.file(APP_TOKENS).text()

/** A palette's constant in the apps' tokens: `const NIGHT = { ... } as const`. */
const APP_PALETTE = /^const ([A-Z]+) = \{([^}]*)\} as const/gm

const APP_COLOUR = /^\s*(\w+): '([^']+)',$/gm

/** A token's name as the apps key it: `--color-surface-2` is `surface2`. */
const appKeyOf = (name: string): string =>
  name.replace('--color-', '').replace(/-(\w)/g, (_dash, letter: string) => letter.toUpperCase())

const RGB = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+)(%?))?\)$/

/** A colour written either way, `rgb(4 8 7 / 66%)` or `rgba(4,8,7,0.66)`, as one comparable value. */
const colourOf = (value: string): string => {
  const [, red, green, blue, alpha = '1', percent = ''] = RGB.exec(value) ?? []
  if (red === undefined) return value.toLowerCase()
  return [red, green, blue, Number(alpha) / (percent === '' ? 1 : 100)].join()
}

/** Each theme's colours in the apps' tokens, by the theme's name. */
const appPalettes = Object.fromEntries(
  [...appTokens.matchAll(APP_PALETTE)].map(([, constant = '', body = '']) => [
    constant.toLowerCase(),
    Object.fromEntries(
      [...body.matchAll(APP_COLOUR)].map(([, key = '', value = '']) => [key, colourOf(value)]),
    ),
  ]),
)

const namesOf = (theme: string): string[] => Object.keys(blocks[theme] ?? {}).toSorted()

describe("the stylesheet's themes", () => {
  it('has a block for every theme Settings offers, and no other', () => {
    expect(Object.keys(blocks).toSorted()).toEqual(Object.values(WREN_THEMES).toSorted())
  })

  it('gives every theme every colour Night declares', () => {
    const night = namesOf(WREN_THEMES.night)
    expect(night.length).toBeGreaterThan(0)
    const uneven = Object.values(WREN_THEMES).filter(
      (theme) => namesOf(theme).join() !== night.join(),
    )
    expect(uneven).toEqual([])
  })

  it("tells the browser each theme's scheme, the one the apps draw the system's bars by", () => {
    const wrong = Object.values(WREN_THEMES).filter(
      (theme) =>
        !new RegExp(
          `\\[data-theme='${theme}'\\] \\{[^}]*color-scheme: ${THEME_SCHEMES[theme]};`,
        ).test(stylesheet),
    )
    expect(wrong).toEqual([])
  })

  it("holds the same value as the apps' tokens for every colour of every theme", () => {
    const drifted = Object.values(WREN_THEMES).flatMap((theme) => {
      const app = appPalettes[theme] ?? {}
      const web = Object.fromEntries(
        Object.entries(blocks[theme] ?? {}).map(([name, value]) => [
          appKeyOf(name),
          colourOf(value),
        ]),
      )
      const keys = Object.keys(app)
      return keys.length === 0
        ? [`${theme}: no palette in the apps`]
        : keys.filter((key) => web[key] !== app[key]).map((key) => `${theme}.${key}`)
    })
    expect(drifted).toEqual([])
  })
})
