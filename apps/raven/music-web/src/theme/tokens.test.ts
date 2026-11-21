import { describe, expect, it } from 'bun:test'
import { COLORS, RADII, SIZES } from '@/theme/tokens'

const GLOBALS = new URL('../styles/globals.scss', import.meta.url)

/** A token's name out of its `var()`: `--size-row-art`. */
const nameOf = (token: string): string => token.replace(/^var\((--[a-z0-9-]+)\)$/, '$1')

describe('the tokens a component is handed by name', () => {
  it('are each declared in globals.scss, so a prop never names a token that is not there', async () => {
    const stylesheet = await Bun.file(GLOBALS).text()
    const named = [SIZES, RADII, COLORS].flatMap((group) => Object.values<string>(group))
    const missing = named.map(nameOf).filter((name) => !stylesheet.includes(`  ${name}:`))
    expect(missing).toEqual([])
  })
})
