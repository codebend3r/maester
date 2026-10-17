import { describe, expect, it } from 'vitest'
import { mergeScopes } from '@/scanner/scannerService'

describe('mergeScopes', () => {
  it('takes the new scope when nothing waits', () => {
    expect(mergeScopes({ waiting: null, scope: { kind: 'quick', places: [] } })).toEqual({
      kind: 'quick',
      places: [],
    })
  })

  it('lets a full scan cover anything', () => {
    expect(
      mergeScopes({ waiting: { kind: 'library' }, scope: { kind: 'places', places: ['/m/a'] } }),
    ).toEqual({ kind: 'library' })
    expect(
      mergeScopes({ waiting: { kind: 'quick', places: ['/m/a'] }, scope: { kind: 'library' } }),
    ).toEqual({ kind: 'library' })
  })

  it('folds a refresh into a quick scan, which still reads the refreshed places', () => {
    expect(
      mergeScopes({
        waiting: { kind: 'places', places: ['/m/a', '/m/b'] },
        scope: { kind: 'quick', places: [] },
      }),
    ).toEqual({ kind: 'quick', places: ['/m/a', '/m/b'] })
    expect(
      mergeScopes({
        waiting: { kind: 'quick', places: ['/m/a'] },
        scope: { kind: 'places', places: ['/m/a/x.mkv', '/m/c'] },
      }),
    ).toEqual({ kind: 'quick', places: ['/m/a', '/m/c'] })
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
