type FakeMediaErrorProps = { code: number; message: string }

/**
 * happy-dom has no MediaError, which the player reads a failed video's
 * codes from. This stands in for it with the browser's codes.
 */
export class FakeMediaError {
  static readonly MEDIA_ERR_ABORTED = 1
  static readonly MEDIA_ERR_NETWORK = 2
  static readonly MEDIA_ERR_DECODE = 3
  static readonly MEDIA_ERR_SRC_NOT_SUPPORTED = 4
  readonly code: number
  readonly message: string

  constructor({ code, message }: FakeMediaErrorProps) {
    this.code = code
    this.message = message
  }
}

Object.defineProperty(globalThis, 'MediaError', { value: FakeMediaError, configurable: true })
