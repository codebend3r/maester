import { registerHappyDom } from '@tooling/web/happy-dom'
import { WritableStream as NativeWritableStream } from 'node:stream/web'

registerHappyDom({ url: 'http://localhost:8484/' })

/*
 * happy-dom swaps in a WritableStream of its own, which Bun's ReadableStream will not pipe to. A
 * browser pipes a response's body to its own, as a download does, so the runtime's is put back.
 */
Object.assign(globalThis, { WritableStream: NativeWritableStream })
