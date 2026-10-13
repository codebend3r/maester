import { describe, expect, it } from 'vitest'
import { showDirOf } from '@/metadata/places'
import { layoutsOf, titleRootOf, withTitleRoots } from '@/scanner/layout'
import type { FoundFile } from '@/scanner/walk'

const found = (path: string, root: string): FoundFile => ({ path, root, size: 1, mtimeMs: 1 })

describe('title roots', () => {
  it('roots a show under its letter folder, and a flat show at the library path', () => {
    expect(
      titleRootOf({
        root: '/m/TV',
        path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv',
        kind: 'shows',
        layout: 'auto',
      }),
    ).toBe('/m/TV/A')
    expect(
      titleRootOf({
        root: '/m/TV',
        path: '/m/TV/Andor/Season 1/Andor - S01E01.mkv',
        kind: 'shows',
        layout: 'auto',
      }),
    ).toBe('/m/TV')
    expect(
      titleRootOf({
        root: '/m/TV',
        path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv',
        kind: 'shows',
        layout: 'flat',
      }),
    ).toBe('/m/TV')
  })

  it('leaves a file at the library path where it is', () => {
    expect(
      titleRootOf({ root: '/m/TV', path: '/m/TV/Pilot.mkv', kind: 'shows', layout: 'auto' }),
    ).toBe('/m/TV')
  })

  it("looks for a show's poster in its own folder under the letter", () => {
    const [file] = withTitleRoots({
      files: [found('/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', '/m/TV')],
      kind: 'shows',
      layout: 'auto',
    })
    expect(file?.root).toBe('/m/TV/A')
    expect(
      showDirOf({
        path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv',
        folder: 'Andor/Season 1',
        fileName: 'Andor - S01E01.mkv',
      }),
    ).toBe('/m/TV/A/Andor')
  })

  it('describes each library path by the group folders its files sit in', () => {
    expect(
      layoutsOf({
        roots: ['/m/TV', '/m/Reality'],
        files: [
          found('/m/TV/A/Andor/Season 1/a.mkv', '/m/TV'),
          found('/m/TV/B/Bluey/Season 1/b.mkv', '/m/TV'),
          found('/m/TV/Requests/Cupertino/Season 1/c.mkv', '/m/TV'),
          found('/m/Reality/Alone/Season 1/d.mkv', '/m/Reality'),
        ],
        kind: 'shows',
        layout: 'auto',
      }),
    ).toEqual([
      { path: '/m/TV', layout: 'lettered', groups: 3 },
      { path: '/m/Reality', layout: 'flat', groups: 0 },
    ])
  })
})
