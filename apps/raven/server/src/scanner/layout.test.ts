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

type FoundProps = { path: string; root: string }

const found = ({ path, root }: FoundProps): FoundFile => ({
  path,
  root,
  size: 1,
  mtimeMs: 1,
})

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
      files: [found({ path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', root: '/m/TV' })],
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
          found({ path: '/m/TV/A/Andor/Season 1/a.mkv', root: '/m/TV' }),
          found({ path: '/m/TV/B/Bluey/Season 1/b.mkv', root: '/m/TV' }),
          found({ path: '/m/TV/Requests/Cupertino/Season 1/c.mkv', root: '/m/TV' }),
          found({ path: '/m/Reality/Alone/Season 1/d.mkv', root: '/m/Reality' }),
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

type RowProps = { id: number; path: string; folder: string }

const row = ({ id, path, folder }: RowProps) => ({
  id,
  path,
  folder,
  fileName: path.slice(path.lastIndexOf('/') + 1),
})

describe('planRelayout', () => {
  const lettered = [
    row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'A/Andor/Season 1' }),
    row({
      id: 2,
      path: '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv',
      folder: 'A/Ahsoka/Season 1',
    }),
    row({ id: 3, path: '/m/Reality/Alone/Season 1/Alone - S01E01.mkv', folder: 'Alone/Season 1' }),
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
      rows: [
        row({ id: 4, path: '/m/Movies/A/Alien (1979)/Alien (1979).mkv', folder: 'A/Alien (1979)' }),
      ],
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

  it("drops a group folder's Fix match once its files sit under several places, though some did not move", () => {
    const plan = planRelayout({
      rows: [
        row({
          id: 1,
          path: '/m/TV/Requests/Cupertino/Season 1/Cupertino - S01E01.mkv',
          folder: 'Requests/Cupertino/Season 1',
        }),
        row({
          id: 2,
          path: '/m/TV/Requests/Chernobyl/Chernobyl - S01E01.mkv',
          folder: 'Requests/Chernobyl',
        }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Requests'],
    })
    expect(plan).toEqual({
      moves: [{ id: 1, folder: 'Cupertino/Season 1' }],
      overrides: [{ from: 'Requests', to: null }],
    })
  })

  it("moves a Fix match kept for a letter folder holding one loose movie to the movie's file", () => {
    const plan = planRelayout({
      rows: [row({ id: 6, path: '/m/Movies/H/Heat (1995).mp4', folder: 'H' })],
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
        row({ id: 6, path: '/m/Movies/H/Heat (1995).mp4', folder: 'H' }),
        row({ id: 7, path: '/m/Movies/H/Hereditary (2018).mp4', folder: 'H' }),
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
      rows: [row({ id: 5, path: '/m/Home/A/Beach/clip.mp4', folder: 'A/Beach' })],
      roots: ['/m/Home'],
      kind: 'other',
      layout: 'auto',
      overrides: [],
    })
    expect(plan).toEqual({ moves: [], overrides: [] })
  })

  it('moves files back under their letter when the library is set to flat', () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Andor'],
    })
    expect(plan.moves).toEqual([{ id: 1, folder: 'A/Andor/Season 1' }])
    expect(plan.overrides).toEqual([{ from: 'Andor', to: 'A' }])
  })

  it('leaves Fix matches where they are when setting flat merges their shows into one', () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
        row({
          id: 2,
          path: '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv',
          folder: 'Ahsoka/Season 1',
        }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Andor', 'Ahsoka'],
    })
    expect(plan).toEqual({
      moves: [
        { id: 1, folder: 'A/Andor/Season 1' },
        { id: 2, folder: 'A/Ahsoka/Season 1' },
      ],
      overrides: [],
    })
  })

  it("drops a Fix match kept for a place with no files once a title lands there, and moves the title's own there", () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Andor', 'A'],
    })
    expect(plan.overrides).toEqual([
      { from: 'Andor', to: 'A' },
      { from: 'A', to: null },
    ])
  })

  it("drops a whole letter's Fix match whichever order its files come in", () => {
    const rows = [
      row({ id: 1, path: '/m/TV/K/K/Season 1/K - S01E01.mkv', folder: 'K/K/Season 1' }),
      row({
        id: 2,
        path: '/m/TV/K/Kingdom/Season 1/Kingdom - S01E01.mkv',
        folder: 'K/Kingdom/Season 1',
      }),
    ]
    const planFor = (ordered: typeof rows) =>
      planRelayout({
        rows: ordered,
        roots: ['/m/TV'],
        kind: 'shows',
        layout: 'auto',
        overrides: ['K'],
      })
    expect(planFor(rows).overrides).toEqual([{ from: 'K', to: null }])
    expect(planFor(rows.toReversed()).overrides).toEqual([{ from: 'K', to: null }])
  })

  it("keeps a show's Fix match at its place when setting flat brings its letter's other shows there", () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV/K/K/Season 1/K - S01E01.mkv', folder: 'K/Season 1' }),
        row({
          id: 2,
          path: '/m/TV/K/Kingdom/Season 1/Kingdom - S01E01.mkv',
          folder: 'Kingdom/Season 1',
        }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['K'],
    })
    expect(plan.overrides).toEqual([])
  })

  it('keeps a Fix match through setting flat and back, though its letter holds other shows', () => {
    const rows = [
      row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
      row({
        id: 2,
        path: '/m/TV/A/Ahsoka/Season 1/Ahsoka - S01E01.mkv',
        folder: 'Ahsoka/Season 1',
      }),
    ]
    type PlanForProps = { layout: 'auto' | 'flat'; files: typeof rows }

    const planFor = ({ layout, files }: PlanForProps) =>
      planRelayout({ rows: files, roots: ['/m/TV'], kind: 'shows', layout, overrides: ['Andor'] })
    const flat = planFor({ layout: 'flat', files: rows })
    expect(flat.overrides).toEqual([])
    const folders = new Map(flat.moves.map((move) => [move.id, move.folder]))
    const relaid = rows.map((file) => ({ ...file, folder: folders.get(file.id) ?? file.folder }))
    expect(relaid.map((file) => file.folder)).toEqual(['A/Andor/Season 1', 'A/Ahsoka/Season 1'])
    const auto = planFor({ layout: 'auto', files: relaid })
    expect(auto.overrides).toEqual([])
    const places = ['Andor'].flatMap((place) => {
      const entry = [...flat.overrides, ...auto.overrides].find((fixed) => fixed.from === place)
      return entry == null ? [place] : (entry.to ?? [])
    })
    expect(places).toContain('Andor')
  })

  it('keeps a Fix match when another library path brings more of its show from under a letter', () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV1/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
        row({
          id: 2,
          path: '/m/TV2/A/Andor/Season 2/Andor - S02E01.mkv',
          folder: 'A/Andor/Season 2',
        }),
      ],
      roots: ['/m/TV1', '/m/TV2'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Andor'],
    })
    expect(plan).toEqual({ moves: [{ id: 2, folder: 'Andor/Season 2' }], overrides: [] })
  })

  it("drops a letter's Fix match left behind by its show when another show takes its place", () => {
    const plan = planRelayout({
      rows: [
        row({
          id: 1,
          path: '/m/TV/K/Kingdom/Season 1/Kingdom - S01E01.mkv',
          folder: 'K/Kingdom/Season 1',
        }),
        row({
          id: 2,
          path: '/m/TV/Requests/Kingdom/Season 2/Kingdom - S02E01.mkv',
          folder: 'Requests/Kingdom/Season 2',
        }),
        row({
          id: 3,
          path: '/m/TV/Requests/K/Season 1/K - S01E01.mkv',
          folder: 'Requests/K/Season 1',
        }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['K'],
    })
    expect(plan).toEqual({
      moves: [
        { id: 1, folder: 'Kingdom/Season 1' },
        { id: 2, folder: 'Kingdom/Season 2' },
        { id: 3, folder: 'K/Season 1' },
      ],
      overrides: [{ from: 'K', to: null }],
    })
  })

  it("moves a loose movie's own Fix match, and drops its letter folder's, when both would land on it", () => {
    const planFor = (overrides: string[]) =>
      planRelayout({
        rows: [row({ id: 6, path: '/m/Movies/H/Heat (1995).mp4', folder: 'H' })],
        roots: ['/m/Movies'],
        kind: 'movies',
        layout: 'auto',
        overrides,
      })
    const expected = [
      { from: 'H', to: null },
      { from: 'H/Heat (1995).mp4', to: 'Heat (1995).mp4' },
    ]
    const byPlace = (entries: ReturnType<typeof planFor>['overrides']) =>
      entries.toSorted((a, b) => a.from.localeCompare(b.from))
    expect(byPlace(planFor(['H', 'H/Heat (1995).mp4']).overrides)).toEqual(expected)
    expect(byPlace(planFor(['H/Heat (1995).mp4', 'H']).overrides)).toEqual(expected)
  })

  it('moves Fix matches along a chain, and drops one left at its end with no files', () => {
    const rows = [
      row({
        id: 1,
        path: '/m/TV/Requests/K/Season 1/K - S01E01.mkv',
        folder: 'Requests/K/Season 1',
      }),
      row({
        id: 2,
        path: '/m/TV/K/Kingdom/Season 1/Kingdom - S01E01.mkv',
        folder: 'K/Kingdom/Season 1',
      }),
    ]
    const chain = planRelayout({
      rows,
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Requests', 'K'],
    })
    expect(chain.overrides).toEqual([
      { from: 'Requests', to: 'K' },
      { from: 'K', to: 'Kingdom' },
    ])
    const ended = planRelayout({
      rows,
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Requests', 'K', 'Kingdom'],
    })
    expect(ended.overrides).toEqual([
      { from: 'Requests', to: 'K' },
      { from: 'K', to: 'Kingdom' },
      { from: 'Kingdom', to: null },
    ])
  })

  it("moves a loose movie's Fix match with it when the library is set to flat", () => {
    const plan = planRelayout({
      rows: [
        row({ id: 6, path: '/m/Movies/H/Heat (1995).mp4', folder: '' }),
        row({ id: 7, path: '/m/Movies/H/Hereditary (2018).mp4', folder: '' }),
      ],
      roots: ['/m/Movies'],
      kind: 'movies',
      layout: 'flat',
      overrides: ['Heat (1995).mp4'],
    })
    expect(plan.overrides).toEqual([{ from: 'Heat (1995).mp4', to: 'H/Heat (1995).mp4' }])
  })

  it("moves a loose episode's Fix match with it when the library is set to flat", () => {
    const plan = planRelayout({
      rows: [
        row({ id: 8, path: '/m/TV/A/Archer - S01E01.mkv', folder: '' }),
        row({ id: 9, path: '/m/TV/A/Atlanta - S01E01.mkv', folder: '' }),
      ],
      roots: ['/m/TV'],
      kind: 'shows',
      layout: 'flat',
      overrides: ['Archer - S01E01.mkv'],
    })
    expect(plan.overrides).toEqual([{ from: 'Archer - S01E01.mkv', to: 'A/Archer - S01E01.mkv' }])
  })

  it('changes nothing in a library whose files were already read again', () => {
    const plan = planRelayout({
      rows: [
        row({ id: 1, path: '/m/TV/A/Andor/Season 1/Andor - S01E01.mkv', folder: 'Andor/Season 1' }),
        row({ id: 2, path: '/m/TV/K/Season 1/K - S01E01.mkv', folder: 'K/Season 1' }),
        row({ id: 3, path: '/m/TV/A/Archer - S01E01.mkv', folder: '' }),
        row({ id: 4, path: '/m/TV/Pilot.mkv', folder: '' }),
      ],
      roots: ['/m/TV/'],
      kind: 'shows',
      layout: 'auto',
      overrides: ['Andor', 'K', 'Archer - S01E01.mkv', 'Pilot.mkv'],
    })
    expect(plan).toEqual({ moves: [], overrides: [] })
  })
})
