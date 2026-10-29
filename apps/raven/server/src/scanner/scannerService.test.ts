import { describe, expect, it } from 'vitest'
import { QUICK_SCAN_REASONS, mergeScopes } from '@/scanner/scannerService'

const { check, boot, asked } = QUICK_SCAN_REASONS

describe('mergeScopes', () => {
  it('takes the new scope when nothing waits', () => {
    expect(
      mergeScopes({ waiting: null, scope: { kind: 'quick', places: [], reason: boot } }),
    ).toEqual({
      kind: 'quick',
      places: [],
      reason: boot,
    })
  })

  it('lets a full scan cover anything', () => {
    expect(
      mergeScopes({ waiting: { kind: 'library' }, scope: { kind: 'places', places: ['/m/a'] } }),
    ).toEqual({ kind: 'library' })
    expect(
      mergeScopes({
        waiting: { kind: 'quick', places: ['/m/a'], reason: asked },
        scope: { kind: 'library' },
      }),
    ).toEqual({ kind: 'library' })
  })

  it('folds a refresh into a quick scan, which still reads the refreshed places', () => {
    expect(
      mergeScopes({
        waiting: { kind: 'places', places: ['/m/a', '/m/b'] },
        scope: { kind: 'quick', places: [], reason: check },
      }),
    ).toEqual({ kind: 'quick', places: ['/m/a', '/m/b'], reason: check })
    expect(
      mergeScopes({
        waiting: { kind: 'quick', places: ['/m/a'], reason: boot },
        scope: { kind: 'places', places: ['/m/a/x.mkv', '/m/c'] },
      }),
    ).toEqual({ kind: 'quick', places: ['/m/a', '/m/c'], reason: boot })
  })

  it('keeps the louder reason of two quick scans: asked over boot over a check', () => {
    const quick = (reason: (typeof QUICK_SCAN_REASONS)[keyof typeof QUICK_SCAN_REASONS]) =>
      ({ kind: 'quick', places: [], reason }) as const
    expect(mergeScopes({ waiting: quick(check), scope: quick(asked) })).toEqual(quick(asked))
    expect(mergeScopes({ waiting: quick(asked), scope: quick(check) })).toEqual(quick(asked))
    expect(mergeScopes({ waiting: quick(boot), scope: quick(check) })).toEqual(quick(boot))
    expect(mergeScopes({ waiting: quick(check), scope: quick(check) })).toEqual(quick(check))
  })

  it('adds up the places of two refreshes, outermost first', () => {
    expect(
      mergeScopes({
        waiting: { kind: 'places', places: ['/m/a/x.mkv'] },
        scope: { kind: 'places', places: ['/m/a', '/m/b'] },
      }),
    ).toEqual({ kind: 'places', places: ['/m/a', '/m/b'] })
  })
})
