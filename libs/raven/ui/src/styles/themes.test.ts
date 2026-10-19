import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_THEME, THEMES, parseTokens } from '@raven/core'

const styles = import.meta.dir
const globals = readFileSync(join(styles, 'globals.scss'), 'utf8')
const themes = readFileSync(join(styles, 'themes.scss'), 'utf8')

/** The declarations in a theme's block of themes.scss, by name. */
const themeBlock = (id: string): Map<string, string> => {
  const start = themes.indexOf(`[data-theme='${id}'] {`)
  if (start === -1) return new Map()
  const body = themes.slice(start, themes.indexOf('\n}', start))
  return new Map(
    [...body.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)].map(([, name = '', value = '']) => [
      name,
      value,
    ]),
  )
}

describe('THEMES', () => {
  it('has a block in themes.scss for every theme, each declaring the same tokens', () => {
    const names = [...themeBlock(DEFAULT_THEME).keys()]
    expect(names.length).toBeGreaterThan(0)
    THEMES.forEach((theme) => {
      expect([...themeBlock(theme.id).keys()]).toEqual(names)
    })
  })

  it("keeps Verdigris's block the same as the defaults on :root", () => {
    const root = new Map(parseTokens(globals).map((token) => [token.name, token.value]))
    themeBlock(DEFAULT_THEME).forEach((value, name) => {
      expect(root.get(name)).toBe(value)
    })
  })

  it('sets a light colour scheme on exactly the light themes', () => {
    THEMES.forEach((theme) => {
      const start = themes.indexOf(`[data-theme='${theme.id}'] {`)
      const block = themes.slice(start, themes.indexOf('\n}', start))
      expect(block).toContain(`color-scheme: ${theme.tone};`)
    })
  })
})
