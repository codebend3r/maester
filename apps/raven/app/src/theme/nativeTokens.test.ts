import { describe, expect, it } from 'bun:test'

import { nativeTokens } from '@/theme/nativeTokens'

describe('nativeTokens', () => {
  it('turns rem into points at 16 to the rem', () => {
    expect(
      nativeTokens({ '--space-0': '0.25rem', '--space-4': '1rem', '--max-width': '110rem' }),
    ).toEqual({
      colours: {},
      numbers: { '--space-0': 4, '--space-4': 16, '--max-width': 1760 },
    })
  })

  it('keeps pixels and plain numbers as numbers', () => {
    expect(
      nativeTokens({
        '--radius-sm': '4px',
        '--radius-pill': '999px',
        '--titlebar-inset': '0px',
        '--line-body': '1.5',
        '--glow': '0.6',
      }).numbers,
    ).toEqual({
      '--radius-sm': 4,
      '--radius-pill': 999,
      '--titlebar-inset': 0,
      '--line-body': 1.5,
      '--glow': 0.6,
    })
  })

  it('keeps hex colours as written', () => {
    expect(nativeTokens({ '--color-night': '#15201e', '--color-on-leaf': '#ffffff' })).toEqual({
      colours: { '--color-night': '#15201e', '--color-on-leaf': '#ffffff' },
      numbers: {},
    })
  })

  it('drops what React Native cannot express', () => {
    expect(
      nativeTokens({
        '--gutter': 'clamp(1.25rem, 4vw, 3.5rem)',
        '--focus-ring': '2px solid var(--color-bark)',
        '--color-line': 'color-mix(in srgb, var(--color-bark) 10%, transparent)',
        '--color-scrim': 'rgb(0 0 0 / 55%)',
        '--fade-from-top': 'linear-gradient(to bottom, rgb(0 0 0 / 70%), rgb(0 0 0 / 0%))',
        '--shadow-menu': '0 8px 24px rgb(0 0 0 / 40%)',
        '--font-display': "'Young Serif', georgia, serif",
        '--tracking-label': '0.06em',
        '--ease-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        '--color-accent': 'oklch(70% 0.1 200)',
      }),
    ).toEqual({ colours: {}, numbers: {} })
  })
})
