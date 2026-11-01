import { describe, expect, it } from 'vitest'
import { createOnce } from '@/once'

describe('createOnce', () => {
  it('shares one run between the callers of a key while it runs', async () => {
    const once = createOnce<number>()
    const made: number[] = []
    let open = (_value: number): void => undefined
    const gate = new Promise<number>((resolve) => {
      open = resolve
    })
    const make = () => {
      made.push(1)
      return gate
    }
    const first = once.run({ key: 'a', make })
    const second = once.run({ key: 'a', make })
    expect(second).toBe(first)
    open(7)
    expect(await Promise.all([first, second])).toEqual([7, 7])
    expect(made).toHaveLength(1)
  })

  it('frees the key once its run settles, failed or not', async () => {
    const once = createOnce<number>()
    await expect(
      once.run({ key: 'a', make: async () => Promise.reject(new Error('no')) }),
    ).rejects.toThrow('no')
    expect(await once.run({ key: 'a', make: async () => 2 })).toBe(2)
    await once.settled()
  })
})
