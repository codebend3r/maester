import { describe, expect, it } from 'bun:test'
import { contrastRatio, parseThemes, parseTokens } from '@/tokens'

const SCSS = `
// The palette.
:root {
  --color-night: #15201e;
  // 7:1 on --color-night,
  // 6:1 on --color-canopy.
  --color-lichen: #9db0a8;

  --space-0: 0.25rem;
  --radius-md: 8px;
  --font-body: 'Instrument Sans Variable', system-ui, sans-serif;
  --font-size-sm: 0.9rem;
  --line-tight: 1.1;
  --focus-ring: 2px solid var(--color-bark);

  color-scheme: dark;
}

.elsewhere {
  --not-a-token: 1px;
}
`

describe('parseTokens', () => {
  it('lists every custom property on :root with its group and the comment above it', () => {
    expect(parseTokens(SCSS)).toEqual([
      { name: '--color-night', value: '#15201e', group: 'colour', note: null },
      {
        name: '--color-lichen',
        value: '#9db0a8',
        group: 'colour',
        note: '7:1 on --color-night, 6:1 on --color-canopy.',
      },
      { name: '--space-0', value: '0.25rem', group: 'space', note: null },
      { name: '--radius-md', value: '8px', group: 'radius', note: null },
      {
        name: '--font-body',
        value: "'Instrument Sans Variable', system-ui, sans-serif",
        group: 'font',
        note: null,
      },
      { name: '--font-size-sm', value: '0.9rem', group: 'font-size', note: null },
      { name: '--line-tight', value: '1.1', group: 'line', note: null },
      { name: '--focus-ring', value: '2px solid var(--color-bark)', group: 'other', note: null },
    ])
  })
})

const THEMES_SCSS = `
// The themes.

[data-theme='verdigris'] {
  --color-night: #15201e;
  // A note inside a block.
  --glow: 0.6;

  color-scheme: dark;
}

[data-theme="patina"] {
  --color-night: #f2ead9;
  --glow: 0.3;

  color-scheme: light;
}

:root {
  --color-night: #000000;
}

.picker [data-theme='nested'] {
  --color-night: #111111;
}
`

describe('parseThemes', () => {
  it('skips whitespace-only and unterminated declarations without backtracking', () => {
    const tabs = '\t'.repeat(50_000)
    expect(
      parseThemes(`[data-theme='test'] {\n  ---:${tabs}\n  --bad:${tabs}!\n  --ok: red;\n}`),
    ).toEqual({
      test: { '--ok': 'red' },
    })
  })
  it("reads each theme's custom properties by its id, in the order they are declared", () => {
    expect(parseThemes(THEMES_SCSS)).toEqual({
      verdigris: { '--color-night': '#15201e', '--glow': '0.6' },
      patina: { '--color-night': '#f2ead9', '--glow': '0.3' },
    })
  })

  it('has no themes for a stylesheet without a theme block', () => {
    expect(parseThemes(':root {\n  --color-night: #000000;\n}\n')).toEqual({})
  })
})

describe('contrastRatio', () => {
  it('matches the ratios the palette documents', () => {
    expect(contrastRatio({ foreground: '#e6e1d6', background: '#a8262f' })).toBeCloseTo(5.4, 1)
    expect(contrastRatio({ foreground: '#e6e1d6', background: '#15201e' })).toBeCloseTo(12.81, 1)
  })

  it('does not care which colour is which', () => {
    expect(contrastRatio({ foreground: '#15201e', background: '#9db0a8' })).toBeCloseTo(7.32, 1)
  })

  it('has no answer for a colour that is not a plain hex value', () => {
    expect(contrastRatio({ foreground: 'rgb(0 0 0 / 55%)', background: '#15201e' })).toBeNull()
  })
})
