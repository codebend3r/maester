import { describe, expect, it } from 'bun:test'
import { USER_DATA_ENV, userDataFrom } from '@/main/userData'

const THROWAWAY = '/tmp/wren-e2e-user'

describe('userDataFrom', () => {
  it("keeps an unpackaged run's data in the folder its environment names", () => {
    const env = { [USER_DATA_ENV]: THROWAWAY }
    expect(userDataFrom({ isPackaged: false, env })).toBe(THROWAWAY)
  })

  it("never moves a packaged app's data", () => {
    const env = { [USER_DATA_ENV]: THROWAWAY }
    expect(userDataFrom({ isPackaged: true, env })).toBeNull()
  })

  it("leaves Electron's own folder when none is named", () => {
    expect(userDataFrom({ isPackaged: false, env: {} })).toBeNull()
    expect(userDataFrom({ isPackaged: false, env: { [USER_DATA_ENV]: '' } })).toBeNull()
  })
})
