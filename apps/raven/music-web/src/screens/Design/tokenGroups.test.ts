import { describe, expect, it } from 'bun:test'
import { parseTokens } from '@raven/core'
import { SAMPLES, groupTokens } from '@/screens/Design/tokenGroups'

const TOKENS = parseTokens(`
  :root {
    --color-bg: #101816;
    --space-2: 0.5rem;
    --radius-md: 14px;
    --font-display: 'Young Serif', georgia, serif;
    --font-weight-medium: 500;
    --font-size-body: 0.9375rem;
    --line-body: 1.375rem;
    --tracking-overline: 0.06em;
    --size-row: 3.75rem;
    --shadow-card: 0 8px 20px black;
    --duration-sheet: 320ms;
    --focus-offset: 2px;
    --type-body: var(--font-weight-medium) var(--font-size-body) / var(--line-body) var(--font-body);
  }
`)

describe('groupTokens', () => {
  const groups = groupTokens(TOKENS)
  const rowsOf = (name: string) => groups.find((group) => group.name === name)?.rows ?? []

  it('puts each token in its group, drawn the way the group is', () => {
    expect(rowsOf('Spacing').map(({ name, sample }) => [name, sample])).toEqual([
      ['--space-2', SAMPLES.bar],
    ])
    expect(rowsOf('Weights').map(({ sample }) => sample)).toEqual([SAMPLES.weight])
    expect(rowsOf('Typefaces').map(({ name }) => name)).toEqual(['--font-display'])
    expect(rowsOf('Sizes').map(({ name }) => name)).toEqual(['--size-row'])
    expect(rowsOf('Motion and opacity').map(({ name }) => name)).toEqual(['--duration-sheet'])
    expect(rowsOf('Layout and focus').map(({ name }) => name)).toEqual(['--focus-offset'])
  })

  it('leaves the colours and the type styles to their own sections', () => {
    const names = groups.flatMap((group) => group.rows.map(({ name }) => name))
    expect(names).not.toContain('--color-bg')
    expect(names).not.toContain('--type-body')
  })
})
