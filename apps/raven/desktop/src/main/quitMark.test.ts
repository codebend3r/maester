import { describe, expect, it } from 'bun:test'
import { createQuitMark } from '@/main/quitMark'

const setup = ({ isEnabled }: { isEnabled: boolean }) => {
  const clock = { ms: 100 }
  const lines: string[] = []
  const mark = createQuitMark({
    isEnabled,
    now: () => clock.ms,
    write: (line) => {
      lines.push(line)
    },
  })
  return { clock, lines, mark }
}

describe('createQuitMark', () => {
  it('prints the time from the first before-quit to the end, once', () => {
    const { clock, lines, mark } = setup({ isEnabled: true })
    mark.started()
    clock.ms = 250
    mark.started()
    clock.ms = 420.4
    mark.ended()
    mark.ended()
    expect(lines).toEqual(['raven-quit-ms 320\n'])
  })

  it('prints nothing for an end without a quit', () => {
    const { lines, mark } = setup({ isEnabled: true })
    mark.ended()
    expect(lines).toEqual([])
  })

  it('prints nothing in a packaged app', () => {
    const { clock, lines, mark } = setup({ isEnabled: false })
    mark.started()
    clock.ms = 300
    mark.ended()
    expect(lines).toEqual([])
  })
})
