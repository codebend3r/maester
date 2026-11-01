import { Injectable } from '@nestjs/common'

/** One switch for background library work, never for a viewer's playback. */
@Injectable()
export class ScanControl {
  private abort = new AbortController()

  get signal(): AbortSignal {
    return this.abort.signal
  }

  get isStopped(): boolean {
    return this.signal.aborted
  }

  setStopped(isStopped: boolean): void {
    if (isStopped) this.abort.abort()
    else if (this.isStopped) this.abort = new AbortController()
  }
}
