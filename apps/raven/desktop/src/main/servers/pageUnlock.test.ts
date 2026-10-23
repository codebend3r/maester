import { PAGE_ORIGIN, SERVER_COOKIES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { createPageUnlock, type PageCookies } from '@/main/servers/pageUnlock'

const jarOf = (values: readonly string[]) => {
  const asked: { url: string; name: string }[] = []
  const cookies: PageCookies = {
    get: async (filter) => {
      asked.push(filter)
      return values.map((value) => ({ value }))
    },
  }
  return { cookies, asked }
}

describe('createPageUnlock', () => {
  it("reads the unlock cookie from the page's jar under /api and answers a Cookie header", async () => {
    const { cookies, asked } = jarOf(['1700000000000.account-one.c2ln-bmVk_'])
    const unlock = createPageUnlock({ cookies, warn: () => undefined })
    expect(await unlock()).toBe(`${SERVER_COOKIES.unlock}=1700000000000.account-one.c2ln-bmVk_`)
    expect(asked).toEqual([{ url: `${PAGE_ORIGIN}/api`, name: SERVER_COOKIES.unlock }])
  })

  it('reads the jar again on every call, so an unlock or a lock in the page counts at once', async () => {
    const values: string[] = []
    const cookies: PageCookies = { get: async () => values.map((value) => ({ value })) }
    const unlock = createPageUnlock({ cookies, warn: () => undefined })
    expect(await unlock()).toBeNull()
    values.push('a.b.c')
    expect(await unlock()).toBe(`${SERVER_COOKIES.unlock}=a.b.c`)
    values.pop()
    expect(await unlock()).toBeNull()
  })

  it.each([
    ['a separator', 'a.b; other=1'],
    ['a line break', 'a.b\r\nx-evil: 1'],
    ['a space', 'a b'],
    ['a quote', 'a"b'],
    ['nothing', ''],
  ])('sends nothing for a value holding %s', async (_name, value) => {
    const { cookies } = jarOf([value])
    expect(await createPageUnlock({ cookies, warn: () => undefined })()).toBeNull()
  })

  it('sends nothing, and warns, when the jar cannot be read', async () => {
    const warnings: string[] = []
    const cookies: PageCookies = {
      get: async () => {
        throw new Error('jar shut')
      },
    }
    const unlock = createPageUnlock({ cookies, warn: (message) => warnings.push(message) })
    expect(await unlock()).toBeNull()
    expect(warnings).toEqual(["Raven could not read the page's unlock: jar shut"])
  })
})
