import { describe, expect, it } from 'bun:test'

import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP_ROUTES = join(import.meta.dir, '..', 'app')
const PHONE_ROUTES = join(import.meta.dir, '..', '..', 'wren-app', 'app')

/** Every route file under `root`, by its path there, layouts left out. */
const routeFilesOf = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('_layout'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted()

describe("Wren on TV's routes", () => {
  it("are the phone app's, page for page, so no Wren has a page another lacks", () => {
    expect(routeFilesOf(APP_ROUTES)).toEqual(routeFilesOf(PHONE_ROUTES))
  })
})
