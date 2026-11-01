import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { PassGuard } from '@/metadata/passGuard'
import { ScanControl } from '@/scanner/scanControl'

describe('pass cancellation', () => {
  it('never revives an interrupted pass when scans resume', async () => {
    const scans = new ScanControl()
    const pass = new PassGuard({
      logger: new Logger('test'),
      failed: 'failed',
      stopped: 'stopped',
      signal: scans.signal,
    })
    const task = vi.fn(async () => undefined)
    await pass.run(task)
    expect(task).toHaveBeenCalledTimes(1)
    scans.setStopped(true)
    scans.setStopped(false)
    await pass.run(task)
    expect(pass.isStopped).toBe(true)
    expect(scans.isStopped).toBe(false)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
