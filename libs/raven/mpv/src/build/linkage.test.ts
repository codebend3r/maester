import { expect, test } from 'bun:test'
import { libmpvLinkLibraries, withLinkLibraries } from '@/build/linkage'

test('libmpv links glslang and the C++ runtime that libplacebo leaves out of its pkg-config file', () => {
  expect(libmpvLinkLibraries).toEqual(['glslang', 'glslang-default-resource-limits', 'c++'])
})

test('withLinkLibraries appends the libraries to LDFLAGS and keeps the rest of the environment', () => {
  const env = { CC: '/usr/bin/clang', LDFLAGS: '-arch arm64 -L/prefix/lib', LIBRARY_PATH: '' }
  expect(withLinkLibraries({ env, libraries: libmpvLinkLibraries })).toEqual({
    CC: '/usr/bin/clang',
    LDFLAGS: '-arch arm64 -L/prefix/lib -lglslang -lglslang-default-resource-limits -lc++',
    LIBRARY_PATH: '',
  })
  expect(env.LDFLAGS).toBe('-arch arm64 -L/prefix/lib')
})

test('withLinkLibraries with no libraries leaves LDFLAGS as it was', () => {
  expect(withLinkLibraries({ env: { LDFLAGS: '-L/prefix/lib' }, libraries: [] })).toEqual({
    LDFLAGS: '-L/prefix/lib',
  })
})
