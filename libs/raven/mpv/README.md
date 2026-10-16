# @raven/mpv

macOS arm64 embedded libmpv foundation for raven desktop. This is a main-process
library, not an IPC surface or a separate player process. The desktop service must
resolve grants/trusted servers and allowlist player commands before calling it.
No web app code changes or native renderer integration are part of P3.

## API and lifecycle

`openMpv({ surface, onEvent })` loads only `resources/darwin-arm64/raven_mpv.node`,
checks client API 2.3+ and mpv 0.40+, and returns a player. A missing library, an old
engine, or an invalid surface rejects, allowing the host to offer its fallback.
There is no system/Homebrew libmpv lookup. Keep the resource directory layout when
packaging, outside the asar. `addonPath` is for an explicit packaged resource path.

- `{ kind: 'window', handle: browserWindow.getNativeWindowHandle() }` must be created
  on Electron's macOS main thread after its content view exists. The handle must
  come from Electron, never the renderer. One surface per content view is allowed.
- `{ kind: 'headless' }` explicitly selects `vo=null`, `ao=null`. A packaged desktop
  must not select this from an environment variable. It is a native-test facility,
  not a simulated player.
- Commands, property reads and writes are asynchronous. `read({ name })` validates
  the reply using that property's guard; observed events are guarded too. Invalid
  native data is reported as an error and pending requests reject. Requests time out
  after 10 seconds. `time-pos` observations are limited to four per second.
  Safe integer writes use mpv's INT64 format (including track ids); fractional
  writes use DOUBLE. Native NODE choices read as numbers, `false` for disabled
  tracks or `'auto'` for automatic selection. Color-space hints read as booleans
  or `'auto'`, not the input spellings `yes`/`no`.
- Always `await player.destroy()` before disposing the BrowserWindow. It is
  idempotent, rejects outstanding requests, disconnects callbacks and terminates
  mpv on a worker. The layer is retained until termination completes. GC and Node's
  async environment cleanup also tear down an abandoned engine off-thread.
- `display()` reports current refresh rate, potential EDR headroom and sort-repair
  count. The desktop service must update `display-fps-override` from Electron's
  matching display and set `target-colorspace-hint=yes` only with headroom above 1,
  rechecking when the window changes display. The safe initial hint is `no`.

The content-view CAMetalLayer sits below Chromium, not inside WebContentsView.
An instance-specific subclass repairs Chromium's subview sorting and restores its
original class on destruction. The view passes hit tests through and is not an
accessibility element. Drawable size follows view/backing-scale changes. The
second mpv patch polls it on every VO event turn and caps idle sleep at 50 ms,
including while paused. The page background must be transparent during native
playback. DevTools must open detached: docked DevTools can hide the video behind an
opaque Chromium view. Electron integration and the visual surface checklist belong
to P5, not the headless tests.

## Reproducible source build

Run targets through Nx from the repository root:

```sh
bunx nx run @raven/mpv:fetch:sources
bunx nx run @raven/mpv:fetch:libmpv
bunx nx run @raven/mpv:build:native
bunx nx run @raven/mpv:test:native
bunx nx run @raven/mpv:audit:native
```

`fetch:sources` is portable and only downloads source. The remaining targets need
macOS arm64, Xcode with its Metal Toolchain, cmake, ninja, meson, pkgconf, Python 3,
make, patch and the normal Apple command-line tools. They never install tools or
change `xcode-select`. Supply `DEVELOPER_DIR` explicitly when necessary. CI uses
Xcode 26.6 on the standard `macos-26` arm64 runner and may install Apple's Metal
component on that disposable runner only. No local system installation is implied.
Homebrew may provide build tools, never the shipped runtime dependencies.

`native/sources.lock.json` pins every runtime source and build-time source dependency
to an immutable official upstream Git commit and SHA-256 of that commit's GitHub
source archive. The hashes were measured from actual upstream downloads and are
checked on every fetch/cache read. They are not claims of detached upstream
signatures. MoltenVK's seven external revisions are cross-checked against its own
pinned revision files. Libplacebo's fast_float, Jinja and MarkupSafe sources are
pinned to its upstream submodule revisions. No Meson download fallbacks, recursive
moving branches or vendor binary packages are used.

The graph builds mpv 0.41.0, FFmpeg 8.1.2, libplacebo 7.360.1, MoltenVK 1.4.2,
dav1d 1.5.3, libass 0.17.5 and their pinned dependencies. FFmpeg's native decoders,
VideoToolbox, dav1d, SecureTransport and subtitle decoders are enabled; libplacebo
uses glslang and Dolby Vision reshaping. LuaJIT supports mpv's built-in stats script.
User config/scripts, ytdl, OSC, default bindings and VO keyboard input are disabled.
The profile enables gpu-next, hardware decoding, display-resample, HDR peak detection,
multichannel PCM and a forced 1 GiB forward/256 MiB backward demuxer cache.

Dependencies are static except libmpv and MoltenVK. Every non-system dylib dependency
must resolve inside the resource directory; `audit:native` rejects host install
names, host rpaths, missing source archives, non-arm64 binaries or invalid signatures.
Install IDs are `@rpath`, library rpaths are loader-relative, and each Mach-O is
signed ad hoc. The addon uses node-addon-api 8.5.0 and N-API 8 with Node 24.19.0
headers checked against Node's official SHASUMS256.txt, independent of Electron's ABI.
The headers and corresponding Node license are checksum-locked in the build script;
cmake-js uses that project-local header directory rather than a host download cache. Build provenance records the
repository revision, compiler, SDK, patches and artifact hashes. This is a pinned
build recipe, not a claim of byte-identical output across different Apple SDKs.

### Resources and source parity

Generated files are ignored, never checked in:

- `resources/darwin-arm64/`: addon, two dylibs and provenance/license notices.
- `native-build/prefix/`: build-only headers, static archives and ffmpeg fixture
  generator. Its CLI is not a desktop runtime resource.
- `native-build/source-bundle/`: every verified upstream source archive, both
  patches, build scripts, node-addon-api source, the Bun lockfile and an archive of
  the exact Git revision CI built. CI uploads this alongside the native resources.

The moltenvk patch is copied unchanged from MPVKit 1.0.0, commit
`288527dffbc6d3e63cce147fc7b520c64a791603`, and compared byte-for-byte during the
build. Its mpv code retains LGPL notices. `0002-moltenvk-resize.patch` is raven's
change on top of that patch and retains the file's license. Main mpv is built GPL;
FFmpeg is LGPL in this graph. Bundling them does not remove the GPL source and
notice obligations of a distributed application. Notices for all pinned sources
and node-addon-api accompany resources; original archives preserve complete source
and licenses. P7 must distribute the matching source bundle/source offer with its
application artifacts, not substitute Homebrew binaries or omit notices. Final app
signing and notarization remain P7 responsibilities.

## Tests and acceptance boundary

```sh
bunx nx run-many -p @raven/mpv -t build typecheck lint:ts format:check test
```

Generic `build` compiles TypeScript only. Generic tests validate the wrapper using
an injected boundary fixture; they do not load libmpv or make native claims. Ubuntu
verify does not need Apple frameworks, libmpv or a Metal toolchain.

`test:native` runs in Node via tsx (the Electron main-process runtime family), not
Bun's N-API implementation. It loads our actual addon and source-built libmpv. Our source-built
ffmpeg generates an MKV with video, two audio tracks, an embedded subtitle and a
sidecar. Tests exercise hardening, load, observed properties, seek, audio/subtitle
selection, stop, file-open errors, invalid handles, idempotent shutdown and 100
load/stop/destroy cycles, fractional property writes and native choice reads/observations.
Subprocesses repeatedly race queued wakeups with explicit destruction, GC and worker
N-API environment shutdown. The raw addon's `lifecycleCounts()` diagnostic reports
process-wide owners, TSFNs and mpv handles, so the parent checks actual reclamation
after each worker exits rather than just a successful exit code. Abandoned owners
remain held by their async cleanup hooks until environment exit, even after GC
terminates their mpv handles. A timer running across the load cycles is a liveness
check, not a p99 performance measurement.

Local P3 implementation/review readiness can be conditional on generic gates and
syntax-only Objective-C++ checks when the developer's Metal Toolchain is absent.
Those checks do not prove native linking, playback, packaging or visual behavior.
The publication checkpoint must wait for exact-head Desktop CI build, audit,
real native-test PASS and matching native/source artifacts before accepting P3 or
starting P4. XDR, 120 Hz, Electron z-order/fullscreen/resize behavior and the codec
manual matrix remain explicitly pending until P5 hardware/UI validation.
