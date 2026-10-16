import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fetchSources } from '@/build/fetchSources'
import { refreshSourceBundle } from '@/build/sourceBundle'
import { auditNative } from '@/build/auditNative'
import { moltenvkBuildCommands } from '@/build/moltenvk'
import {
  digest,
  output,
  prefix,
  project,
  requireMacArm,
  resources,
  run,
  work,
  write,
} from '@/build/context'

requireMacArm()
// No installation or global Xcode selection here. CI supplies its own scoped toolchain.
await run({ args: ['xcrun', 'metal', '--version'] })
const locked = await fetchSources()
const src = (name: string) => resolve(work, 'sources', name)
const jobs = String(Math.max(1, Number(await output({ args: ['sysctl', '-n', 'hw.logicalcpu'] }))))
const sdk = await output({ args: ['xcrun', '--sdk', 'macosx', '--show-sdk-path'] })
const env = {
  CC: await output({ args: ['xcrun', '--find', 'clang'] }),
  CXX: await output({ args: ['xcrun', '--find', 'clang++'] }),
  OBJC: await output({ args: ['xcrun', '--find', 'clang'] }),
  OBJCXX: await output({ args: ['xcrun', '--find', 'clang++'] }),
  CPATH: '',
  C_INCLUDE_PATH: '',
  CPLUS_INCLUDE_PATH: '',
  LIBRARY_PATH: '',
  DYLD_LIBRARY_PATH: '',
  DYLD_FALLBACK_LIBRARY_PATH: '',
  MACOSX_DEPLOYMENT_TARGET: '12.0',
  SDKROOT: sdk,
  CFLAGS: `-O2 -fPIC -arch arm64 -mmacosx-version-min=12.0 -isysroot ${sdk} -I${prefix}/include`,
  CXXFLAGS: `-O2 -fPIC -arch arm64 -mmacosx-version-min=12.0 -isysroot ${sdk} -I${prefix}/include`,
  LDFLAGS: `-arch arm64 -mmacosx-version-min=12.0 -isysroot ${sdk} -L${prefix}/lib`,
  PKG_CONFIG_PATH: '',
  PKG_CONFIG_LIBDIR: `${prefix}/lib/pkgconfig:${prefix}/share/pkgconfig`,
  CMAKE_PREFIX_PATH: prefix,
  CMAKE_IGNORE_PREFIX_PATH: '/opt/homebrew;/usr/local',
  SOURCE_DATE_EPOCH: '1761868800',
  GIT_CEILING_DIRECTORIES: resolve(work, 'sources'),
}
await rm(resolve(work, 'sources'), { recursive: true, force: true })
await rm(prefix, { recursive: true, force: true })
await rm(resources, { recursive: true, force: true })
await mkdir(prefix, { recursive: true })
await locked.reduce(async (previous, source) => {
  await previous
  await mkdir(src(source.name), { recursive: true })
  await run({
    args: [
      'tar',
      '-xzf',
      resolve(work, 'archives', `${source.name}.tar.gz`),
      '--strip-components=1',
      '-C',
      src(source.name),
    ],
  })
}, Promise.resolve())

const meson = async ({ name, options }: { name: string; options: string[] }) => {
  const build = resolve(src(name), '_build')
  await run({
    args: [
      'meson',
      'setup',
      build,
      src(name),
      '--prefix',
      prefix,
      '--libdir=lib',
      '--buildtype=release',
      '--wrap-mode=nofallback',
      '-Dauto_features=disabled',
      '-Ddefault_library=static',
      '-Dprefer_static=true',
      ...options,
    ],
    env,
  })
  await run({ args: ['meson', 'compile', '-C', build, '-j', jobs], env })
  await run({ args: ['meson', 'install', '-C', build], env })
}
const cmake = async ({ name, options }: { name: string; options: string[] }) => {
  const build = resolve(src(name), '_build')
  await run({
    args: [
      'cmake',
      '-S',
      src(name),
      '-B',
      build,
      '-G',
      'Ninja',
      '-DCMAKE_BUILD_TYPE=Release',
      `-DCMAKE_INSTALL_PREFIX=${prefix}`,
      '-DCMAKE_INSTALL_LIBDIR=lib',
      '-DCMAKE_OSX_ARCHITECTURES=arm64',
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
      '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local',
      '-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF',
      '-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF',
      '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
      ...options,
    ],
    env,
  })
  await run({ args: ['cmake', '--build', build, '--parallel', jobs], env })
  await run({ args: ['cmake', '--install', build], env })
}

// Stage every MoltenVK dependency from checked archives. Its fetchDependencies script
// clones full repositories, so we reproduce its staging/build steps without network.
const mvk = src('moltenvk')
await [
  'cereal',
  'SPIRV-Cross',
  'SPIRV-Headers',
  'SPIRV-Tools',
  'Volk',
  'Vulkan-Headers',
  'Vulkan-Tools',
].reduce(async (previous, name) => {
  await previous
  const source = locked.find((entry) => entry.name === name)
  if (!source) throw new Error(`Missing MoltenVK source: ${name}`)
  const revision = (
    await Bun.file(resolve(mvk, 'ExternalRevisions', `${name}_repo_revision`)).text()
  ).trim()
  if (revision !== source.commit) throw new Error(`MoltenVK revision mismatch: ${name}`)
  await cp(src(name), resolve(mvk, 'External', name), { recursive: true })
}, Promise.resolve())
await cp(src('SPIRV-Headers'), resolve(mvk, 'External/SPIRV-Tools/external/spirv-headers'), {
  recursive: true,
})
await run({
  args: [
    'unzip',
    '-o',
    '-q',
    resolve(mvk, 'Templates/spirv-tools/build.zip'),
    '-d',
    resolve(mvk, 'External/SPIRV-Tools'),
  ],
})
await moltenvkBuildCommands({ source: mvk, buildRoot: work }).reduce(async (previous, command) => {
  await previous
  await run({ ...command, env })
}, Promise.resolve())
await mkdir(resolve(prefix, 'lib/pkgconfig'), { recursive: true })
await mkdir(resolve(prefix, 'include'), { recursive: true })
await cp(
  resolve(mvk, 'Package/Release/MoltenVK/dynamic/dylib/macOS/libMoltenVK.dylib'),
  resolve(prefix, 'lib/libMoltenVK.dylib'),
)
await cp(resolve(mvk, 'MoltenVK/include/MoltenVK'), resolve(prefix, 'include/MoltenVK'), {
  recursive: true,
})
await cp(resolve(src('Vulkan-Headers'), 'include/vulkan'), resolve(prefix, 'include/vulkan'), {
  recursive: true,
})
await cp(resolve(src('Vulkan-Headers'), 'include/vk_video'), resolve(prefix, 'include/vk_video'), {
  recursive: true,
})
await write({
  path: resolve(prefix, 'lib/pkgconfig/vulkan.pc'),
  content: `prefix=${prefix}\nlibdir=\${prefix}/lib\nincludedir=\${prefix}/include\nName: Vulkan\nDescription: Source-built MoltenVK\nVersion: 1.4.0\nLibs: -L\${libdir} -lMoltenVK\nCflags: -I\${includedir}\n`,
})
await run({
  args: [
    'install_name_tool',
    '-id',
    '@rpath/libMoltenVK.dylib',
    resolve(prefix, 'lib/libMoltenVK.dylib'),
  ],
})

await cmake({ name: 'zlib', options: ['-DZLIB_BUILD_EXAMPLES=OFF'] })
// zlib's build also installs a dylib; static is intentional throughout this graph.
await Promise.all(
  (await readdir(resolve(prefix, 'lib')))
    .filter((name) => name.startsWith('libz') && name.endsWith('.dylib'))
    .map((name) => rm(resolve(prefix, 'lib', name))),
)
await cmake({
  name: 'freetype',
  options: [
    '-DFT_DISABLE_ZLIB=FALSE',
    `-DZLIB_LIBRARY=${prefix}/lib/libz.a`,
    `-DZLIB_INCLUDE_DIR=${prefix}/include`,
    '-DFT_DISABLE_BZIP2=TRUE',
    '-DFT_DISABLE_PNG=TRUE',
    '-DFT_DISABLE_HARFBUZZ=TRUE',
    '-DFT_DISABLE_BROTLI=TRUE',
  ],
})
await meson({ name: 'fribidi', options: ['-Ddocs=false', '-Dbin=false', '-Dtests=false'] })
await meson({
  name: 'harfbuzz',
  options: ['-Dfreetype=enabled', '-Dtests=disabled', '-Dutilities=disabled'],
})
await meson({ name: 'libass', options: ['-Dcoretext=enabled', '-Dasm=enabled'] })
await meson({ name: 'dav1d', options: ['-Denable_tools=false', '-Denable_tests=false'] })
await cmake({
  name: 'glslang',
  options: [
    '-DBUILD_EXTERNAL=OFF',
    '-DENABLE_OPT=OFF',
    '-DGLSLANG_TESTS=OFF',
    '-DENABLE_GLSLANG_BINARIES=OFF',
  ],
})
await ['fast_float', 'jinja', 'markupsafe', 'Vulkan-Headers'].reduce(async (previous, name) => {
  await previous
  await cp(src(name), resolve(src('libplacebo'), '3rdparty', name), { recursive: true })
}, Promise.resolve())
await meson({
  name: 'libplacebo',
  options: [
    '-Dvulkan=enabled',
    '-Dvk-proc-addr=enabled',
    '-Dglslang=enabled',
    // libplacebo's meson only searches the compiler's default dirs plus this one for libSPIRV.a
    `-Dvulkan-sdk=${prefix}`,
    '-Ddovi=enabled',
    '-Ddemos=false',
  ],
})
await run({
  args: [
    'make',
    '-j',
    jobs,
    'BUILDMODE=static',
    `PREFIX=${prefix}`,
    `MACOSX_DEPLOYMENT_TARGET=12.0`,
    'XCFLAGS=-fPIC',
  ],
  cwd: src('luajit'),
  env,
})
await run({
  args: ['make', 'install', 'BUILDMODE=static', `PREFIX=${prefix}`],
  cwd: src('luajit'),
  env,
})
await run({
  args: [
    './configure',
    `--prefix=${prefix}`,
    '--arch=arm64',
    '--target-os=darwin',
    `--cc=${env.CC}`,
    '--enable-pic',
    '--enable-static',
    '--disable-shared',
    '--disable-autodetect',
    '--disable-doc',
    '--disable-debug',
    '--enable-libdav1d',
    '--enable-videotoolbox',
    '--enable-audiotoolbox',
    '--enable-securetransport',
    '--enable-zlib',
    '--enable-iconv',
    '--pkg-config-flags=--static',
    `--extra-cflags=${env.CFLAGS}`,
    `--extra-ldflags=${env.LDFLAGS}`,
  ],
  cwd: src('ffmpeg'),
  env,
})
await run({ args: ['make', '-j', jobs], cwd: src('ffmpeg'), env })
await run({ args: ['make', 'install'], cwd: src('ffmpeg'), env })

const patch = resolve(project, 'native/patches/0001-player-add-moltenvk-context.patch')
if (
  digest(await Bun.file(patch).bytes()) !==
  digest(
    await Bun.file(
      resolve(
        src('mpvkit'),
        'Sources/BuildScripts/patch/libmpv/0001-player-add-moltenvk-context.patch',
      ),
    ).bytes(),
  )
)
  throw new Error('MPVKit patch provenance mismatch')
await ['0001-player-add-moltenvk-context.patch', '0002-moltenvk-resize.patch'].reduce(
  async (previous, name) => {
    await previous
    await run({
      args: [
        'patch',
        '-p1',
        '--batch',
        '--forward',
        '-i',
        resolve(project, 'native/patches', name),
      ],
      cwd: src('mpv'),
    })
  },
  Promise.resolve(),
)
await meson({
  name: 'mpv',
  options: [
    '-Ddefault_library=shared',
    '-Dlibmpv=true',
    '-Dcplayer=false',
    '-Dbuild-date=false',
    '-Dvulkan=enabled',
    '-Dmoltenvk=enabled',
    '-Dgl=disabled',
    '-Dswift-build=disabled',
    '-Dcocoa=enabled',
    '-Dcoreaudio=enabled',
    '-Davfoundation=enabled',
    '-Dvideotoolbox-pl=enabled',
    '-Dlua=luajit',
    '-Diconv=enabled',
    '-Dzlib=enabled',
  ],
})

await mkdir(resolve(resources, 'lib'), { recursive: true })
await cp(resolve(prefix, 'lib/libmpv.2.dylib'), resolve(resources, 'lib/libmpv.2.dylib'))
await cp(resolve(prefix, 'lib/libMoltenVK.dylib'), resolve(resources, 'lib/libMoltenVK.dylib'))
await run({
  args: [
    'install_name_tool',
    '-id',
    '@rpath/libmpv.2.dylib',
    resolve(resources, 'lib/libmpv.2.dylib'),
  ],
})
const libraries = await output({ args: ['otool', '-L', resolve(resources, 'lib/libmpv.2.dylib')] })
const moltenInstall = libraries
  .split('\n')
  .map((line) => line.trim().split(' ')[0])
  .find((name) => name.endsWith('/libMoltenVK.dylib'))
if (!moltenInstall) throw new Error('libmpv must link our MoltenVK')
await run({
  args: [
    'install_name_tool',
    '-change',
    moltenInstall,
    '@rpath/libMoltenVK.dylib',
    resolve(resources, 'lib/libmpv.2.dylib'),
  ],
})
// Each library resolves its sibling without DYLD_LIBRARY_PATH or a host Vulkan loader.
await ['libMoltenVK.dylib', 'libmpv.2.dylib'].reduce(async (previous, name) => {
  await previous
  const path = resolve(resources, 'lib', name)
  const commands = await output({ args: ['otool', '-l', path] })
  const rpaths = [...commands.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (\S+) /g)].map(
    (match) => match[1],
  )
  await rpaths.reduce(async (prior, rpath) => {
    await prior
    await run({ args: ['install_name_tool', '-delete_rpath', rpath, path] })
  }, Promise.resolve())
}, Promise.resolve())
await run({
  args: [
    'install_name_tool',
    '-add_rpath',
    '@loader_path',
    resolve(resources, 'lib/libmpv.2.dylib'),
  ],
})
await ['libMoltenVK.dylib', 'libmpv.2.dylib'].reduce(async (previous, name) => {
  await previous
  await run({ args: ['codesign', '--force', '--sign', '-', resolve(resources, 'lib', name)] })
}, Promise.resolve())

const sourceBundle = resolve(work, 'source-bundle')
await rm(sourceBundle, { recursive: true, force: true })
await cp(resolve(work, 'archives'), resolve(sourceBundle, 'archives'), { recursive: true })
await write({
  path: resolve(resources, 'provenance/sources.json'),
  content: JSON.stringify(locked, null, 2) + '\n',
})
await locked.reduce(async (previous, source) => {
  await previous
  const paths = Array.from(
    new Bun.Glob('**/{LICENSE*,COPYING*,COPYRIGHT*,Copyright*,NOTICE*,FTL.TXT}').scanSync({
      cwd: src(source.name),
      onlyFiles: true,
    }),
  )
  if (paths.length === 0) throw new Error(`No license notices found for ${source.name}`)
  await paths
    .filter((path) => !path.includes('_build/'))
    .reduce(async (prior, path) => {
      await prior
      const destination = resolve(resources, 'provenance/licenses', source.name, path)
      await mkdir(dirname(destination), { recursive: true })
      await cp(resolve(src(source.name), path), destination)
    }, Promise.resolve())
}, Promise.resolve())
await write({
  path: resolve(resources, 'provenance/build.json'),
  content:
    JSON.stringify(
      {
        platform: 'darwin-arm64',
        revision: await output({ args: ['git', 'rev-parse', 'HEAD'] }),
        sources: digest(JSON.stringify(locked)),
        xcode: await output({ args: ['xcodebuild', '-version'] }),
        sdk,
        clang: await output({ args: [env.CC, '--version'] }),
        patches: await Promise.all(
          ['0001-player-add-moltenvk-context.patch', '0002-moltenvk-resize.patch'].map(
            async (name) => ({
              name,
              sha256: digest(await Bun.file(resolve(project, 'native/patches', name)).bytes()),
            }),
          ),
        ),
      },
      null,
      2,
    ) + '\n',
})
await refreshSourceBundle()
await auditNative({ requireAddon: false })
