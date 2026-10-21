import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DIST = resolve(import.meta.dir, '../dist')
const ENTRY = resolve(DIST, 'headless.js')
const FORBIDDEN_PACKAGES = ['react-dom', 'react-router', 'react-router-dom']
const DOM_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'EventSource',
  'HTMLElement',
]

/** Every `from '...'`, bare `import '...'` and dynamic `import('...')` specifier of an ES module. */
const specifiersOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] ?? '')

/** A specifier that names `name` or one of its subpaths, as `react-dom/client` does. */
const isOfPackage = ({ specifier, name }: { specifier: string; name: string }): boolean =>
  specifier === name || specifier.startsWith(`${name}/`)

/**
 * Each DOM global `source` reads, by name: not a property of something else
 * (`.window`), an object key (`window:`) or a string.
 */
const domReadsOf = (source: string): string[] =>
  [
    ...source.matchAll(new RegExp(`(?<![.\\w$"'\`])(${DOM_GLOBALS.join('|')})\\b(?!\\s*:)`, 'g')),
  ].map((match) => match[1] ?? '')

/** The entry and every chunk it imports, transitively, with each one's source. */
const walk = ({ file, seen = new Map() }: { file: string; seen?: ReadonlyMap<string, string> }) => {
  if (seen.has(file)) return seen
  const source = readFileSync(file, 'utf8')
  const withFile = new Map(seen).set(file, source)
  return specifiersOf(source)
    .filter((specifier) => specifier.startsWith('.'))
    .reduce(
      (found, specifier) => walk({ file: resolve(dirname(file), specifier), seen: found }),
      withFile,
    )
}

describe('the headless entry', () => {
  test('loads with no DOM', async () => {
    expect(typeof globalThis.window).toBe('undefined')
    expect(typeof globalThis.document).toBe('undefined')
    const entry = await import('@raven/ui/headless')
    expect(entry.videoReducer).toBeFunction()
    expect(entry.initialVideoState(12).time).toBe(12)
    expect(entry.createSelectionStore().getState().selecting).toBeFalse()
    expect(entry.usePageBackdrop.getState().current).toBeNull()
  })

  test('reaches for no DOM package or stylesheet', () => {
    const graph = walk({ file: ENTRY })
    const imports = [...graph.values()].flatMap(specifiersOf)
    expect(graph.size).toBeGreaterThan(0)
    expect(
      imports.filter((specifier) =>
        FORBIDDEN_PACKAGES.some((name) => isOfPackage({ specifier, name })),
      ),
    ).toEqual([])
    expect(imports.some((specifier) => specifier.endsWith('.css'))).toBeFalse()
    expect([...graph.keys()].some((file) => file.endsWith('.css'))).toBeFalse()
  })

  test('reads no DOM global anywhere in its code, not only as it loads', () => {
    expect([...walk({ file: ENTRY }).values()].flatMap(domReadsOf)).toEqual([])
  })

  test('the scan sees what it is meant to catch', () => {
    expect(
      specifiersOf(
        `import { a } from "./a.js"; import "./b.css"; await import('react-dom/client')`,
      ),
    ).toEqual(['./a.js', './b.css', 'react-dom/client'])
    expect(isOfPackage({ specifier: 'react-dom/client', name: 'react-dom' })).toBeTrue()
    expect(isOfPackage({ specifier: 'react-domino', name: 'react-dom' })).toBeFalse()
    expect(
      domReadsOf(
        'const a = window.innerWidth; new EventSource(u); x.window; ({ window: n }); "document"',
      ),
    ).toEqual(['window', 'EventSource'])
  })
})
