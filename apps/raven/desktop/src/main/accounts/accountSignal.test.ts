import { describe, expect, it } from 'bun:test'
import { createAccountSignal } from '@/main/accounts/accountSignal'

describe('createAccountSignal', () => {
  it('tells every listener, and stops telling one that was removed', () => {
    const signal = createAccountSignal()
    const heard: string[] = []
    const stop = signal.listen(() => heard.push('a'))
    signal.listen(() => heard.push('b'))
    signal.notify()
    stop()
    signal.notify()
    expect(heard).toEqual(['a', 'b', 'b'])
  })

  it('reaches the rest when a listener throws', () => {
    const signal = createAccountSignal()
    const heard: string[] = []
    signal.listen(() => {
      throw new Error('relay gone')
    })
    signal.listen(() => heard.push('heard'))
    signal.notify()
    expect(heard).toEqual(['heard'])
  })
})
