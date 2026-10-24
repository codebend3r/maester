import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB_BRAND = join(import.meta.dir, '../../../web/public/brand')
const APP_BRAND = join(import.meta.dir, 'brand')

describe("the app's marks", () => {
  it.each(['raven-mark-on-dark.png', 'raven-mark-on-light.png'])(
    "are the web's own %s, byte for byte",
    (file) => {
      expect(readFileSync(join(APP_BRAND, file)).equals(readFileSync(join(WEB_BRAND, file)))).toBe(
        true,
      )
    },
  )
})
