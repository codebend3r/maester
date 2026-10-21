import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_THEME, THEMES, THEME_TONES, parseThemes, parseTokens } from '@raven/core'

import { appThemeOf } from '@/theme/appTheme'
import { nativeTokens } from '@/theme/nativeTokens'
import { FIXED_TOKENS, OVER_PICTURE_TOKENS, PALETTE_TOKENS } from '@/theme/tokenNames'

// The stylesheets themselves, not the built `@raven/ui/designTokens` the app reads, so a
// stale build or a parse that drifted from them fails here.
const STYLES = join(import.meta.dir, '../../../../../libs/raven/ui/src/styles')
const themesScss = parseThemes(readFileSync(join(STYLES, 'themes.scss'), 'utf8'))
const root = nativeTokens(
  Object.fromEntries(
    parseTokens(readFileSync(join(STYLES, 'globals.scss'), 'utf8')).map(({ name, value }) => [
      name,
      value,
    ]),
  ),
).colours

/** The palette `tokens` name, read off a set of declarations. */
const paletteFrom = ({
  tokens,
  declared,
}: {
  tokens: Record<string, string>
  declared: Record<string, string>
}) => Object.fromEntries(Object.entries(tokens).map(([use, token]) => [use, declared[token]]))

const PATINA = THEMES.find((theme) => theme.name === 'Patina')?.id ?? DEFAULT_THEME

describe('appThemeOf', () => {
  it('paints every theme in the colours themes.scss gives it', () => {
    THEMES.forEach(({ id }) => {
      expect(appThemeOf(id).palette).toMatchObject(
        paletteFrom({ tokens: PALETTE_TOKENS, declared: themesScss[id] ?? {} }),
      )
    })
  })

  it("paints the default theme in globals.scss's own :root colours", () => {
    expect(appThemeOf(DEFAULT_THEME).palette).toMatchObject(
      paletteFrom({ tokens: PALETTE_TOKENS, declared: root }),
    )
  })

  it('paints what sits on a picture as globals.scss does, whatever the theme', () => {
    THEMES.forEach(({ id }) => {
      expect(appThemeOf(id).palette).toMatchObject(
        paletteFrom({ tokens: FIXED_TOKENS, declared: root }),
      )
    })
  })

  it("draws over the video in globals.scss's on-picture colours, the web player's, whatever the theme", () => {
    const overPicture = paletteFrom({ tokens: OVER_PICTURE_TOKENS, declared: root })
    THEMES.forEach(({ id }) => {
      const { palette, overPicture: drawn } = appThemeOf(id)
      expect(drawn).toMatchObject(overPicture)
      expect(drawn.played).toBe(palette.played)
    })
    expect(appThemeOf(PATINA).overPicture.text).toBe(root['--color-on-picture'] ?? '')
    expect(appThemeOf(PATINA).overPicture.quiet).toBe(root['--color-picture-glass'] ?? '')
    expect(appThemeOf(PATINA).overPicture.text).not.toBe(appThemeOf(PATINA).palette.text)
  })

  it("gives Patina the light logo and Patina's own --color-night as the ground", () => {
    const patina = appThemeOf(PATINA)
    expect(PATINA).not.toBe(DEFAULT_THEME)
    expect(patina.tone).toBe(THEME_TONES.light)
    expect(patina.palette.ground).toBe(themesScss[PATINA]?.['--color-night'] ?? '')
    expect(patina.palette.ground).toBe('#ebe5d8')
  })

  it('gives each light theme the light logo and each dark one the dark', () => {
    THEMES.forEach(({ id, tone }) => {
      expect(appThemeOf(id).tone).toBe(tone)
    })
    expect(THEMES.filter(({ tone }) => tone === THEME_TONES.light).map(({ name }) => name)).toEqual(
      ['Patina', 'Mint'],
    )
  })

  it('hands back the same theme each time, so a selector on it never re-renders for nothing', () => {
    expect(appThemeOf(PATINA)).toBe(appThemeOf(PATINA))
    expect(appThemeOf(PATINA).palette).toBe(appThemeOf(PATINA).palette)
  })
})
