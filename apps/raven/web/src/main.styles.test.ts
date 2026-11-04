import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

type RuleIndexProps = {
  css: string
  selector: RegExp
  declaration: string
}

const ruleIndex = ({ css, selector, declaration }: RuleIndexProps) => {
  const index = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].findIndex(
    (match) => selector.test(match[1] ?? '') && (match[2] ?? '').includes(declaration),
  )
  expect(
    index,
    `Missing emitted rule: ${selector.source} with ${declaration}`,
  ).toBeGreaterThanOrEqual(0)
  return index
}

const expectPlayerOverridesAfterPrimitives = (css: string) => {
  const button = ruleIndex({
    css,
    selector: /^\._button_[\w-]+$/,
    declaration: 'padding:var(--space-1) var(--space-3)',
  })
  const quiet = ruleIndex({
    css,
    selector: /^\._quiet_[\w-]+$/,
    declaration: 'background:var(--color-moss)',
  })
  const back = ruleIndex({
    css,
    selector: /^\._back_[\w-]+$/,
    declaration: 'grid-area:back',
  })
  const next = ruleIndex({
    css,
    selector: /^\._next_[\w-]+$/,
    declaration: 'border-color:#0000',
  })
  const panelBack = ruleIndex({
    css,
    selector: /^\._panelBack_[\w-]+$/,
    declaration: 'padding-left:0',
  })
  expect(back).toBeGreaterThan(quiet)
  expect(next).toBeGreaterThan(quiet)
  expect(panelBack).toBeGreaterThan(quiet)
  expect(panelBack).toBeGreaterThan(button)
  return quiet
}

test('shared emitted CSS keeps Button defaults before Player overrides', async () => {
  const css = await Bun.file(fileURLToPath(import.meta.resolve('@raven/ui/styles.css'))).text()
  expectPlayerOverridesAfterPrimitives(css)
})

/** The `type` of a file the bundle emits that is not a chunk of code. */
const OUTPUT_TYPES = { asset: 'asset' } as const

type Emitted = { fileName: string; text: string }

const textOf = (source: string | Uint8Array) =>
  typeof source === 'string' ? source : new TextDecoder().decode(source)

// Build in memory once for every test here: DOM test loaders do not exercise Vite's extracted CSS or its HTML.
const built: Promise<readonly Emitted[]> = build({
  root: fileURLToPath(new URL('..', import.meta.url)),
  logLevel: 'silent',
  build: { write: false },
}).then((result) =>
  (Array.isArray(result) ? result : [result])
    .flatMap((output) => ('output' in output ? output.output : []))
    .flatMap((output) =>
      output.type === OUTPUT_TYPES.asset
        ? [{ fileName: output.fileName, text: textOf(output.source) }]
        : [],
    ),
)

test('web emitted CSS keeps shared Button defaults before host and Player overrides', async () => {
  const stylesheets = (await built).filter(({ fileName }) => fileName.endsWith('.css'))
  expect(stylesheets).toHaveLength(1)
  const css = stylesheets[0]?.text
  if (css === undefined) throw new Error('Web build emitted no stylesheet')
  const quiet = expectPlayerOverridesAfterPrimitives(css)
  const itemHeaderBack = ruleIndex({
    css,
    selector: /^\._back_[\w-]+$/,
    declaration: 'background:var(--color-night-glass)',
  })
  expect(itemHeaderBack).toBeGreaterThan(quiet)
}, 30_000)

test('emitted index.html paints its loader before the stylesheet arrives, and fetches its fonts at once', async () => {
  const html = (await built).find(({ fileName }) => fileName === 'index.html')?.text ?? ''
  const mark = await Bun.file(
    new URL('../public/brand/raven-mark-mono.svg', import.meta.url),
  ).text()
  const markPath = /\sd="([^"]+)"/.exec(mark)?.[1] ?? ''
  expect(markPath).not.toBe('')
  expect(html).toContain(`d="${markPath}"`)
  expect(html).toContain('class="boot-loader"')
  // A linked stylesheet in the head would hold the loader back until it arrived.
  expect(html).not.toMatch(/rel="stylesheet"/)
  expect(html).toMatch(/<link rel="preload" as="style" crossorigin href="\/assets\/[^"]+\.css">/)
  // Its fonts are fetched beside the code, not once the stylesheet names them.
  expect(html).toMatch(
    /<link rel="preload" as="font" type="font\/woff2" crossorigin="" href="\/assets\/instrument-sans-latin-wdth-normal-[\w-]+\.woff2">/,
  )
  expect(html).toMatch(
    /<link rel="preload" as="font" type="font\/woff2" crossorigin="" href="\/assets\/young-serif-latin-400-normal-[\w-]+\.woff2">/,
  )
}, 30_000)

test("index.html's loader falls back to the default theme's colours", async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text()
  const tokens = await Bun.file(fileURLToPath(import.meta.resolve('@raven/ui/styles.css'))).text()
  const fallbacks = [...html.matchAll(/var\((--color-[\w-]+), (#[\da-f]+)\)/g)]
  expect(fallbacks).toHaveLength(3)
  fallbacks.forEach(([, token, colour]) => {
    expect(tokens).toContain(`${token}:${colour}`)
  })
})
