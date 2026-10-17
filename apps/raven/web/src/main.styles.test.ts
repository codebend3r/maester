import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ruleIndex = ({
  css,
  selector,
  declaration,
}: {
  css: string
  selector: RegExp
  declaration: string
}) => {
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

test('web emitted CSS keeps shared Button defaults before host and Player overrides', async () => {
  // Build in memory: DOM test loaders do not exercise Vite's extracted CSS ordering.
  const result = await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const stylesheets = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .flatMap((output) =>
      output.type === 'asset' && output.fileName.endsWith('.css') ? [output.source] : [],
    )
  expect(stylesheets).toHaveLength(1)
  const source = stylesheets[0]
  if (source === undefined) throw new Error('Web build emitted no stylesheet')
  const css = typeof source === 'string' ? source : new TextDecoder().decode(source)
  const quiet = expectPlayerOverridesAfterPrimitives(css)
  const itemHeaderBack = ruleIndex({
    css,
    selector: /^\._back_[\w-]+$/,
    declaration: 'background:var(--color-night-glass)',
  })
  expect(itemHeaderBack).toBeGreaterThan(quiet)
}, 30_000)
