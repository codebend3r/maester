import { parseTokens } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { groupTokens } from '@/pages/DesignPage/tokenGroups'

const TOKENS = parseTokens(`
  :root {
    --color-night: #15201e;
    --glow: 0.6;
    --shadow-text: 0 1px 2px rgb(0 0 0 / 60%);
    --space-0: 0.25rem;
    --section-gap: clamp(3rem, 5vw, 4.5rem);
    --tracking-eyebrow: 0.12em;
    --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
    --measure: 38rem;
    --field-size: 2.75rem;
    --focus-ring: 2px solid var(--color-bark);
    --someday: 1;
  }
`)

describe('groupTokens', () => {
  it('puts each token but the colours in the first group that has it, with how it is drawn', () => {
    expect(
      groupTokens(TOKENS).map((group) => [
        group.name,
        group.rows.map((row) => `${row.name} ${row.sample}`),
      ]),
    ).toEqual([
      ['Spacing', ['--space-0 bar', '--section-gap bar']],
      ['Tracking', ['--tracking-eyebrow eyebrow']],
      ['Easing', ['--ease-out ease']],
      ['Shadows', ['--shadow-text textShadow']],
      ['Fades and glow', ['--glow glow']],
      [
        'Layout and focus',
        ['--measure width', '--field-size height', '--focus-ring focus', '--someday none'],
      ],
    ])
  })
})
