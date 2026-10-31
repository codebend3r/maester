import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import { BrowseController } from '@/fs/browseController'

describe('folder browser containment', () => {
  const state = { dir: '' }
  const root = () => join(state.dir, 'media')
  const controller = () => new BrowseController({ ...readServerConfig({}), browseRoot: root() })

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-browse-'))
    await mkdir(root())
    await mkdir(join(state.dir, 'outside'))
    await symlink(join(state.dir, 'outside'), join(root(), 'escape'))
    await symlink(root(), join(state.dir, 'alias'))
  })

  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it('rejects paths outside the root before resolving them, even if they do not exist', async () => {
    await expect(controller().browse(join(state.dir, 'missing'))).rejects.toMatchObject({
      status: 400,
    })
    await expect(controller().browse(join(root(), '..', 'outside'))).rejects.toMatchObject({
      status: 400,
    })
    await expect(controller().browse(`${root()}-other`)).rejects.toMatchObject({ status: 400 })
  })

  it('rejects symlinks that resolve outside the root', async () => {
    await expect(controller().browse(join(root(), 'escape'))).rejects.toMatchObject({ status: 400 })
  })

  it('accepts both the configured root alias and its canonical path', async () => {
    const alias = join(state.dir, 'alias')
    const browser = new BrowseController({ ...readServerConfig({}), browseRoot: alias })
    const canonical = await realpath(root())
    expect(await browser.browse(alias)).toMatchObject({ path: canonical, parent: null })
    expect(await browser.browse(canonical)).toMatchObject({ path: canonical, parent: null })
  })

  it('still browses the root itself', async () => {
    const canonical = await realpath(root())
    expect(await controller().browse()).toMatchObject({ path: canonical, parent: null })
    expect(await controller().browse(root())).toMatchObject({ path: canonical, parent: null })
    expect(await controller().browse(canonical)).toMatchObject({ path: canonical, parent: null })
  })
})
