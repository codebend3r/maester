import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adHocSignArgs,
  isMachO,
  listSignables,
  type Signable,
  signAdHoc,
  signingOrder,
  verifyAppArgs,
} from '@/build/machO'

describe('isMachO', () => {
  it('accepts a 64-bit little-endian Mach-O, as arm64 writes it', () => {
    expect(isMachO(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c]))).toBe(true)
  })

  it('accepts a universal binary', () => {
    expect(isMachO(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))).toBe(true)
  })

  it('refuses a zip', () => {
    expect(isMachO(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
  })

  it('refuses a short file', () => {
    expect(isMachO(new Uint8Array([0x7b, 0x22]))).toBe(false)
  })

  it('refuses an empty file', () => {
    expect(isMachO(new Uint8Array([]))).toBe(false)
  })
})

describe('signingOrder', () => {
  const app = '/o/a.app'
  const inApp = (path: string) => join(app, path)
  const entries: Signable[] = [
    { path: inApp('Contents/MacOS/a'), kind: 'machO' },
    { path: inApp('Contents/Frameworks/E.framework'), kind: 'bundle' },
    { path: inApp('Contents/Frameworks/E.framework/Versions/A/E'), kind: 'machO' },
    {
      path: inApp('Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib'),
      kind: 'machO',
    },
    { path: inApp('Contents/Frameworks/H.app'), kind: 'bundle' },
    { path: inApp('Contents/Frameworks/H.app/Contents/MacOS/H'), kind: 'machO' },
    { path: inApp('Contents/Resources/mpv/darwin-arm64/raven_mpv.node'), kind: 'machO' },
    { path: inApp('Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib'), kind: 'machO' },
    { path: '/o/other', kind: 'machO' },
  ]
  const order = signingOrder({ app, entries })
  const at = (path: string) => order.indexOf(path)

  it('signs every file before the bundle that holds it', () => {
    expect(at(inApp('Contents/Frameworks/E.framework/Versions/A/E'))).toBeLessThan(
      at(inApp('Contents/Frameworks/E.framework')),
    )
    expect(
      at(inApp('Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib')),
    ).toBeLessThan(at(inApp('Contents/Frameworks/E.framework')))
    expect(at(inApp('Contents/Frameworks/H.app/Contents/MacOS/H'))).toBeLessThan(
      at(inApp('Contents/Frameworks/H.app')),
    )
  })

  it('signs libmpv before the addon that links it', () => {
    expect(at(inApp('Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib'))).toBeLessThan(
      at(inApp('Contents/Resources/mpv/darwin-arm64/raven_mpv.node')),
    )
  })

  it('signs the app last and leaves out what is outside it', () => {
    expect(order.at(-1)).toBe(app)
    expect(order).not.toContain('/o/other')
    // The eight paths inside the app, then the app.
    expect(order).toHaveLength(9)
  })

  it('goes deepest first, then by path', () => {
    expect(order).toEqual([
      inApp('Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib'),
      inApp('Contents/Frameworks/E.framework/Versions/A/E'),
      inApp('Contents/Frameworks/H.app/Contents/MacOS/H'),
      inApp('Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib'),
      inApp('Contents/Resources/mpv/darwin-arm64/raven_mpv.node'),
      inApp('Contents/Frameworks/E.framework'),
      inApp('Contents/Frameworks/H.app'),
      inApp('Contents/MacOS/a'),
      app,
    ])
  })

  it('never signs with --deep', () => {
    expect(order.flatMap((path) => adHocSignArgs({ path }))).not.toContain('--deep')
  })
})

describe('adHocSignArgs', () => {
  it('signs one path ad hoc', () => {
    expect(adHocSignArgs({ path: '/o/a.app/Contents/MacOS/a' })).toEqual([
      '--sign',
      '-',
      '--force',
      '/o/a.app/Contents/MacOS/a',
    ])
  })
})

describe('verifyAppArgs', () => {
  it('verifies the whole app strictly, nested code included', () => {
    expect(verifyAppArgs({ app: '/o/a.app' })).toEqual([
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '/o/a.app',
    ])
  })
})

describe('an app folder', () => {
  const MACH_O = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])
  let root = ''
  let app = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'raven-machO-'))
    app = join(root, 'a.app')
    const framework = join(app, 'Contents/Frameworks/E.framework')
    await mkdir(join(framework, 'Versions/A/Resources'), { recursive: true })
    await mkdir(join(app, 'Contents/Frameworks/H.app/Contents/MacOS'), { recursive: true })
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true })
    await mkdir(join(app, 'Contents/Resources/mpv/darwin-arm64/lib'), { recursive: true })
    await writeFile(join(app, 'Contents/MacOS/a'), MACH_O)
    await writeFile(join(app, 'Contents/Info.plist'), '<?xml version="1.0"?>')
    await writeFile(join(framework, 'Versions/A/E'), MACH_O)
    await writeFile(join(framework, 'Versions/A/Resources/empty'), '')
    await symlink('A', join(framework, 'Versions/Current'))
    await symlink('Versions/Current/E', join(framework, 'E'))
    await writeFile(join(app, 'Contents/Frameworks/H.app/Contents/MacOS/H'), MACH_O)
    await writeFile(join(app, 'Contents/Resources/mpv/darwin-arm64/raven_mpv.node'), MACH_O)
    await writeFile(join(app, 'Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib'), MACH_O)
    await writeFile(join(app, 'Contents/Resources/app.asar'), 'PK\u0003\u0004')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists the Mach-O files and the nested bundles, and skips symlinks and data', async () => {
    const found = await listSignables({ app })
    expect(found.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: join(app, 'Contents/Frameworks/E.framework'), kind: 'bundle' },
      { path: join(app, 'Contents/Frameworks/E.framework/Versions/A/E'), kind: 'machO' },
      { path: join(app, 'Contents/Frameworks/H.app'), kind: 'bundle' },
      { path: join(app, 'Contents/Frameworks/H.app/Contents/MacOS/H'), kind: 'machO' },
      { path: join(app, 'Contents/MacOS/a'), kind: 'machO' },
      { path: join(app, 'Contents/Resources/mpv/darwin-arm64/lib/libmpv.2.dylib'), kind: 'machO' },
      { path: join(app, 'Contents/Resources/mpv/darwin-arm64/raven_mpv.node'), kind: 'machO' },
    ])
  })

  it('signs one path at a time in signing order, then verifies the app', async () => {
    const calls: string[] = []
    const inFlight = { now: 0, max: 0 }
    await signAdHoc({
      app,
      run: async ({ command, args }) => {
        inFlight.now += 1
        inFlight.max = Math.max(inFlight.max, inFlight.now)
        calls.push(`${command} ${args.join(' ')}`)
        await Promise.resolve()
        inFlight.now -= 1
      },
    })
    const order = signingOrder({ app, entries: await listSignables({ app }) })
    expect(calls).toEqual([
      ...order.map((path) => `codesign ${adHocSignArgs({ path }).join(' ')}`),
      `codesign ${verifyAppArgs({ app }).join(' ')}`,
    ])
    expect(inFlight.max).toBe(1)
  })

  it('stops at the first signing that fails and never verifies', async () => {
    const calls: string[] = []
    const signing = signAdHoc({
      app,
      run: async ({ args }) => {
        calls.push(args.join(' '))
        if (calls.length === 2) throw new Error('codesign failed')
      },
    })
    await expect(signing).rejects.toThrow('codesign failed')
    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.startsWith('--verify'))).toBe(false)
  })
})
