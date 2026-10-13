import { describe, expect, it } from 'vitest'
import { showDirOf } from '@/metadata/places'
import {
  indexedLayoutsOf,
  layoutsOf,
  planRelayout,
  titleRootOf,
  withTitleRoots,
} from '@/scanner/layout'
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

  it('describes each library path by the files the index holds under it, and leaves out one holding none', () => {
    expect(
      indexedLayoutsOf({
        rows: [
          { path: '/m/TV/A/Andor/Season 1/a.mkv' },
          { path: '/m/TV/B/Bluey/Season 1/b.mkv' },
          { path: '/m/Old/C/Cupertino/Season 1/c.mkv' },
        ],
        roots: ['/m/TV', '/m/Empty'],
        kind: 'shows',
        layout: 'auto',
      }),
    ).toEqual([{ path: '/m/TV', layout: 'lettered', groups: 2 }])
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

const row = (id: number, path: string, folder: string) => ({
  id,
  path,
  folder,
  fileName: path.slice(path.lastIndexOf('/') + 1),
})

describe('planRelayout', () => {
  const lettered = [
    row(1, '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', 'A/Andor/Season 1'),
    row(2, '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv', 'A/Ahsoka/Season 1'),
    row(3, '/m/Reality/Alone/Season 1/Alone - S01E01.mkv', 'Alone/Season 1'),
  ]

  it('moves files indexed under their letter, and leaves a flat path alone', () => {
    const plan = planRelayout({
      rows: lettered,
      roots: ['/m/TV', '/m/Reality'],
      kind: 'shows',
      layout: 'auto',
      overrides: [],
    })
    expect(plan.moves).toEqual([
      { id: 1, folder: 'Andor/Season 1' },
      { id: 2, folder: 'Ahsoka/Season 1' },
    ])
  })

  it('drops a Fix match kept for a whole letter, and keeps one for a flat show', () => {
    const plan = planRelayout({
      rows: lettered,
      roots: ['/m/TV', '/m/Reality'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['A', 'Alone'],
    })
    expect(plan.overrides).toEqual([{ from: 'A', to: null }])
  })

  it('moves a Fix match kept for a movie folder under a letter', () => {
    const plan = planRelayout({
      rows: [row(4, '/m/Movies/A/Alien (1979)/Alien (1979).mkv', 'A/Alien (1979)')],
      roots: ['/m/Movies'],
      kind: 'movies',
      layout: 'auto',
      overrides: ['A/Alien (1979)', 'A/Alien (1979)/Alien (1979).mkv'],
    })
    expect(plan.moves).toEqual([{ id: 4, folder: 'Alien (1979)' }])
    expect(plan.overrides).toEqual([
      { from: 'A/Alien (1979)', to: 'Alien (1979)' },
      { from: 'A/Alien (1979)/Alien (1979).mkv', to: 'Alien (1979)/Alien (1979).mkv' },
    ])
  })

  it('leaves a Fix match where it is while a file that does not move still uses its place', () => {
    const plan = planRelayout({
      rows: [
        row(
          1,
          '/m/TV/Requests/Cupertino/Season 1/Cupertino - S01E01.mkv',
          'Requests/Cupertino/Season 1',
        ),
        row(2, '/m/TV/Requests/Chernobyl/Chernobyl - S01E01.mkv', 'Requests/Chernobyl'),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Requests'],
    })
    expect(plan).toEqual({ moves: [{ id: 1, folder: 'Cupertino/Season 1' }], overrides: [] })
  })

  it("moves a Fix match kept for a letter folder holding one loose movie to the movie's file", () => {
    const plan = planRelayout({
      rows: [row(6, '/m/Movies/H/Heat (1995).mp4', 'H')],
      roots: ['/m/Movies'],
      kind: 'movies',
      layout: 'auto',
      overrides: ['H'],
    })
    expect(plan).toEqual({
      moves: [{ id: 6, folder: '' }],
      overrides: [{ from: 'H', to: 'Heat (1995).mp4' }],
    })
  })

  it('drops a Fix match kept for a letter folder holding several loose movies', () => {
    const plan = planRelayout({
      rows: [
        row(6, '/m/Movies/H/Heat (1995).mp4', 'H'),
        row(7, '/m/Movies/H/Hereditary (2018).mp4', 'H'),
      ],
      roots: ['/m/Movies'],
      kind: 'movies',
      layout: 'auto',
      overrides: ['H'],
    })
    expect(plan.overrides).toEqual([{ from: 'H', to: null }])
  })

  it('moves nothing in a library that is never matched, though it has letter folders', () => {
    const plan = planRelayout({
      rows: [row(5, '/m/Home/A/Beach/clip.mp4', 'A/Beach')],
      roots: ['/m/Home'],
      kind: 'other',
      layout: 'auto',
      overrides: [],
    })
    expect(plan).toEqual({ moves: [], overrides: [] })
  })

  it('moves files back under their letter when the library is set to flat', () => {
    const plan = planRelayout({
      rows: [row(1, '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', 'Andor/Season 1')],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Andor'],
    })
    expect(plan.moves).toEqual([{ id: 1, folder: 'A/Andor/Season 1' }])
    expect(plan.overrides).toEqual([{ from: 'Andor', to: 'A' }])
  })
})
