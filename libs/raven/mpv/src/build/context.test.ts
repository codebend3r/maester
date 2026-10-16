import { expect, test } from 'bun:test'
import { isSource, sources } from '@/build/context'
import { nodeHeaders } from '@/build/nodeHeaders'

test('source lock names the complete native graph using immutable upstream archives and digests', async () => {
  const locked = await sources()
  expect(locked.map((source) => source.name).toSorted()).toEqual(
    [
      'mpv',
      'ffmpeg',
      'libplacebo',
      'dav1d',
      'libass',
      'freetype',
      'harfbuzz',
      'fribidi',
      'zlib',
      'luajit',
      'glslang',
      'moltenvk',
      'mpvkit',
      'cereal',
      'SPIRV-Cross',
      'SPIRV-Headers',
      'SPIRV-Tools',
      'Volk',
      'Vulkan-Headers',
      'Vulkan-Tools',
      'fast_float',
      'jinja',
      'markupsafe',
    ].toSorted(),
  )
  expect(new Set(locked.map((source) => source.name)).size).toBe(locked.length)
  locked.forEach((source) => {
    expect(isSource(source)).toBe(true)
    expect(isSource({ ...source, commit: 'main' })).toBe(false)
    expect(isSource({ ...source, sha256: 'unverified' })).toBe(false)
    expect(isSource({ ...source, name: '../outside' })).toBe(false)
    expect(isSource({ ...source, repository: 'https://untrusted.invalid/source' })).toBe(false)
    expect(isSource({ ...source, url: source.url.replace('https:', 'http:') })).toBe(false)
  })
  expect(isSource(null)).toBe(false)
  expect(nodeHeaders.archive.url).toBe(
    `https://nodejs.org/dist/v${nodeHeaders.version}/node-v${nodeHeaders.version}-headers.tar.gz`,
  )
  expect(nodeHeaders.archive.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(nodeHeaders.license.sha256).toMatch(/^[a-f0-9]{64}$/)
})
