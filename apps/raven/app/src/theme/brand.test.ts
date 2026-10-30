import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RAVEN_MARK } from '@/theme/brand/ravenMark'

const WEB_BRAND = join(import.meta.dir, '../../../web/public/brand')

const webMark = (file: string): string => readFileSync(join(WEB_BRAND, file), 'utf8')

type AttributeOfProps = { svg: string; name: string }

/** The one value an attribute holds in an SVG, or null when it is not there. */
const attributeOf = ({ svg, name }: AttributeOfProps): string | null =>
  new RegExp(` ${name}="([^"]+)"`, 'u').exec(svg)?.[1] ?? null

describe("the app's mark", () => {
  it("is the web's own path, in its box", () => {
    const dark = webMark('raven-mark-on-dark.svg')
    expect(attributeOf({ svg: dark, name: 'viewBox' })).toBe(RAVEN_MARK.viewBox)
    expect(attributeOf({ svg: dark, name: 'd' })).toBe(RAVEN_MARK.body)
    expect(attributeOf({ svg: webMark('raven-mark-on-light.svg'), name: 'd' })).toBe(
      RAVEN_MARK.body,
    )
  })

  it("wears the web's colours: its body on each ground, and its eye", () => {
    const dark = webMark('raven-mark-on-dark.svg')
    expect(attributeOf({ svg: dark, name: 'fill' })).toBe(RAVEN_MARK.colours.onDark)
    expect(attributeOf({ svg: webMark('raven-mark-on-light.svg'), name: 'fill' })).toBe(
      RAVEN_MARK.colours.onLight,
    )
    const eye = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)" fill="([^"]+)"/u.exec(dark)
    expect(eye?.slice(1)).toEqual([
      String(RAVEN_MARK.eye.cx),
      String(RAVEN_MARK.eye.cy),
      String(RAVEN_MARK.eye.r),
      RAVEN_MARK.colours.eye,
    ])
  })
})
