import { create } from 'zustand'

/**
 * Counts every change to any server's cookies, so what reads the jar outside `fetch` (the
 * pictures' headers) reads it again after an unlock.
 */
export const useCookieVersion = create<{ version: number }>()(() => ({ version: 0 }))

export const bumpCookieVersion = (): void =>
  useCookieVersion.setState(({ version }) => ({ version: version + 1 }))
