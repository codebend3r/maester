import { describe, expect, test } from 'bun:test'
import { libraryName, parseDefinitions, parseImports, symbolProblems } from '@/build/symbols'

// Lines copied from `nm -um` and `nm -jU` of the CI libmpv built from f24529e, whose
// window surface crashed in pl_glslang_init, and of its addon.
const brokenImports = [
  '                 (undefined) external _CVBufferCopyAttachments (from CoreVideo)',
  '                 (undefined) weak external __swift_FORCE_LOAD_$_swiftCoreFoundation (from libswiftCoreFoundation)',
  '                 (undefined) external _$s7Elements10SetAlgebraPTl (from libswiftCore)',
  '                 (undefined) external __Z19GetDefaultResourcesv (dynamically looked up)',
  '                 (undefined) external __ZN7glslang17InitializeProcessEv (dynamically looked up)',
  '                 (undefined) external __Znwm (dynamically looked up)',
].join('\n')
const brokenDefinitions = [
  '_mpv_create',
  '_pl_glslang_init',
  '_symbolic $s5swift15EventSubscriberP',
].join('\n')
const fixedDefinitions = [
  '_mpv_create',
  '_pl_glslang_init',
  '__Z19GetDefaultResourcesv',
  '__ZN7glslang17InitializeProcessEv',
].join('\n')
const libmpvDependencies = [
  '@rpath/libmpv.2.dylib',
  '/System/Library/Frameworks/CoreVideo.framework/Versions/A/CoreVideo',
  '/usr/lib/swift/libswiftCore.dylib',
  '/usr/lib/swift/libswiftCoreFoundation.dylib',
  '/usr/lib/libc++.1.dylib',
  '/usr/lib/libSystem.B.dylib',
  '@rpath/libMoltenVK.dylib',
]

describe('parseImports', () => {
  test('reads what each undefined symbol binds to, keeping weak imports and spaces in names', () => {
    expect(parseImports({ listing: brokenImports })).toEqual([
      { kind: 'bound', symbol: '_CVBufferCopyAttachments', library: 'CoreVideo' },
      {
        kind: 'bound',
        symbol: '__swift_FORCE_LOAD_$_swiftCoreFoundation',
        library: 'libswiftCoreFoundation',
      },
      { kind: 'bound', symbol: '_$s7Elements10SetAlgebraPTl', library: 'libswiftCore' },
      { kind: 'lookup', symbol: '__Z19GetDefaultResourcesv' },
      { kind: 'lookup', symbol: '__ZN7glslang17InitializeProcessEv' },
      { kind: 'lookup', symbol: '__Znwm' },
    ])
    expect(
      parseImports({ listing: '  (undefined) external -[Some method:] (from Foundation)' }),
    ).toEqual([{ kind: 'bound', symbol: '-[Some method:]', library: 'Foundation' }])
  })

  test('rejects a line it cannot read rather than letting it pass unchecked', () => {
    expect(() =>
      parseImports({ listing: '0000000000001234 (__TEXT,__text) external _mpv_create' }),
    ).toThrow('Unrecognized nm import line')
    expect(() =>
      parseImports({ listing: '  (undefined) external _x (from <flat-namespace>' }),
    ).toThrow('Unrecognized nm import line')
  })

  test('an empty listing has no imports', () => {
    expect(parseImports({ listing: '' })).toEqual([])
  })
})

test('parseDefinitions keeps every defined name, spaces included', () => {
  expect(parseDefinitions({ listing: brokenDefinitions })).toEqual(
    new Set(['_mpv_create', '_pl_glslang_init', '_symbolic $s5swift15EventSubscriberP']),
  )
})

test('libraryName gives the short name nm prints for an install name', () => {
  expect(
    [
      '/usr/lib/libc++.1.dylib',
      '/usr/lib/libSystem.B.dylib',
      '@rpath/libmpv.2.dylib',
      '@rpath/libMoltenVK.dylib',
      '/usr/lib/swift/libswiftCore.dylib',
      '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
    ].map((installName) => libraryName({ installName })),
  ).toEqual(['libc++', 'libSystem', 'libmpv', 'libMoltenVK', 'libswiftCore', 'AppKit'])
})

describe('symbolProblems', () => {
  test('names the unresolved glslang in the broken libmpv and every other dynamic lookup', () => {
    const problems = symbolProblems({
      file: 'lib/libmpv.2.dylib',
      imports: parseImports({ listing: brokenImports }),
      definitions: parseDefinitions({ listing: brokenDefinitions }),
      dependencies: libmpvDependencies,
    })
    expect(problems).toEqual([
      'lib/libmpv.2.dylib leaves glslang unresolved, so the window surface would crash in pl_glslang_init: __Z19GetDefaultResourcesv, __ZN7glslang17InitializeProcessEv',
      'lib/libmpv.2.dylib does not define glslang: __ZN7glslang17InitializeProcessEv, __Z19GetDefaultResourcesv',
      'lib/libmpv.2.dylib looks up symbols that nothing it loads provides: __Z19GetDefaultResourcesv, __ZN7glslang17InitializeProcessEv, __Znwm',
    ])
  })

  test('passes a libmpv that defines glslang and binds every import to a library it loads', () => {
    expect(
      symbolProblems({
        file: 'lib/libmpv.2.dylib',
        imports: [
          { kind: 'bound', symbol: '_CVBufferCopyAttachments', library: 'CoreVideo' },
          { kind: 'bound', symbol: '__Znwm', library: 'libc++' },
        ],
        definitions: parseDefinitions({ listing: fixedDefinitions }),
        dependencies: libmpvDependencies,
      }),
    ).toEqual([])
  })

  test('rejects an import bound to a library the file does not load', () => {
    expect(
      symbolProblems({
        file: 'lib/libMoltenVK.dylib',
        imports: [{ kind: 'bound', symbol: '_vkFoo', library: 'libvulkan' }],
        definitions: new Set(),
        dependencies: ['@rpath/libMoltenVK.dylib', '/usr/lib/libSystem.B.dylib'],
      }),
    ).toEqual(['lib/libMoltenVK.dylib binds _vkFoo to libvulkan, which it does not load'])
  })

  test('lets the addon look up N-API from its host process and nothing else', () => {
    const dependencies = ['@rpath/raven_mpv.node', '@rpath/libmpv.2.dylib']
    expect(
      symbolProblems({
        file: 'raven_mpv.node',
        imports: [
          { kind: 'lookup', symbol: '_napi_create_function' },
          { kind: 'lookup', symbol: '_node_api_get_module_file_name' },
          { kind: 'bound', symbol: '_mpv_create', library: 'libmpv' },
        ],
        definitions: new Set(),
        dependencies,
      }),
    ).toEqual([])
    expect(
      symbolProblems({
        file: 'raven_mpv.node',
        imports: [
          { kind: 'lookup', symbol: '_napi_create_function' },
          { kind: 'lookup', symbol: '_mpv_create' },
        ],
        definitions: new Set(),
        dependencies,
      }),
    ).toEqual(['raven_mpv.node looks up symbols that nothing it loads provides: _mpv_create'])
  })
})
