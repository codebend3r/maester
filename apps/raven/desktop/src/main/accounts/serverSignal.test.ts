import { describe, expect, it } from 'bun:test'
import { createServerSignal } from '@/main/accounts/serverSignal'

describe('createServerSignal', () => {
  it('tells every listener, and stops telling one that was removed', () => {
    const signal = createServerSignal()
    const heard: string[] = []
    const stop = signal.listen(({ serverId }) => heard.push(`a ${serverId}`))
    signal.listen(({ serverId }) => heard.push(`b ${serverId}`))
    signal.notify({ serverId: 'one' })
    stop()
    signal.notify({ serverId: 'two' })
    expect(heard).toEqual(['a one', 'b one', 'b two'])
  })

  it('reaches the rest when a listener throws', () => {
    const signal = createServerSignal()
    const heard: string[] = []
    signal.listen(() => {
      throw new Error('relay gone')
    })
    signal.listen(({ serverId }) => heard.push(serverId))
    signal.notify({ serverId: 'one' })
    expect(heard).toEqual(['one'])
  })
})
