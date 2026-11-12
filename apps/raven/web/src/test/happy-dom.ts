import { GlobalRegistrator } from '@happy-dom/global-registrator'
import HTMLElementConfig from 'happy-dom/lib/config/HTMLElementConfig'
import { WritableStream as NativeWritableStream } from 'node:stream/web'

/*
 * Bun test has no DOM by default. Register happy-dom's globals (window,
 * document, etc.) before any test module, or Testing Library, evaluates.
 */
GlobalRegistrator.register({ url: 'http://localhost:8484/' })

/*
 * happy-dom swaps in a WritableStream of its own, which Bun's ReadableStream will not pipe to. A
 * browser pipes a response's body to its own, as a download does, so the runtime's is put back.
 */
Object.assign(globalThis, { WritableStream: NativeWritableStream })

/*
 * happy-dom does not know <search>, so it makes an HTMLUnknownElement and
 * React warns the tag is unrecognized. It is a plain HTMLElement holding flow
 * content, as <section> is.
 */
Object.assign(HTMLElementConfig, { search: HTMLElementConfig.section })
