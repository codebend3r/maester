import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SECRET_FILES_ENV, withSecretFiles } from '@/secretFiles'

describe('withSecretFiles', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lays each secret file over the variable it is named after, trimmed', () => {
    writeFileSync(join(dir, 'ADMIN_PASSWORD'), 'from-file\n')
    writeFileSync(join(dir, 'TMDB_API_TOKEN'), '  token  ')
    const env = withSecretFiles({
      env: { [SECRET_FILES_ENV.dir]: dir, ADMIN_PASSWORD: 'from-env', PORT: '8484' },
    })
    expect(env).toMatchObject({
      ADMIN_PASSWORD: 'from-file',
      TMDB_API_TOKEN: 'token',
      PORT: '8484',
    })
  })

  it('leaves the given environment as it was', () => {
    writeFileSync(join(dir, 'LIBRARY_PIN'), '1234')
    const given = { [SECRET_FILES_ENV.dir]: dir }
    withSecretFiles({ env: given })
    expect(given).toEqual({ [SECRET_FILES_ENV.dir]: dir })
  })

  it('skips folders and names no variable could have', () => {
    mkdirSync(join(dir, 'NESTED'))
    writeFileSync(join(dir, '.hidden'), 'x')
    writeFileSync(join(dir, 'lower_case'), 'x')
    const env = withSecretFiles({ env: { [SECRET_FILES_ENV.dir]: dir } })
    expect(Object.keys(env)).toEqual([SECRET_FILES_ENV.dir])
  })

  it('is the environment as it was when the folder is missing', () => {
    const missing = join(dir, 'missing')
    expect(withSecretFiles({ env: { [SECRET_FILES_ENV.dir]: missing } })).toEqual({
      [SECRET_FILES_ENV.dir]: missing,
    })
  })

  it.skipIf(process.getuid?.() === 0)('throws when a secret cannot be read', () => {
    const secret = join(dir, 'ADMIN_PASSWORD')
    writeFileSync(secret, 'hidden')
    chmodSync(secret, 0o000)
    expect(() => withSecretFiles({ env: { [SECRET_FILES_ENV.dir]: dir } })).toThrow()
  })

  it('sets nothing for an empty file, so the variable it names keeps its value', () => {
    writeFileSync(join(dir, 'ADMIN_PASSWORD'), '  \n')
    const env = withSecretFiles({
      env: { [SECRET_FILES_ENV.dir]: dir, ADMIN_PASSWORD: 'from-env' },
    })
    expect(env).toMatchObject({ ADMIN_PASSWORD: 'from-env' })
  })

  it('throws for a secret that is a dangling link, rather than reading no secrets at all', () => {
    symlinkSync(join(dir, 'gone'), join(dir, 'LIBRARY_PIN'))
    expect(() => withSecretFiles({ env: { [SECRET_FILES_ENV.dir]: dir } })).toThrow()
  })
})
