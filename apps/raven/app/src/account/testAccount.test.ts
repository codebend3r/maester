import { describe, expect, it } from 'bun:test'

import { testAccountOf } from '@/account/testAccount'

describe('testAccountOf', () => {
  it('names an account only when both its email and its password are set', () => {
    expect(testAccountOf({ email: 'pat@example.com', password: 'hunter2' })).toEqual({
      email: 'pat@example.com',
      password: 'hunter2',
    })
    expect(testAccountOf({ email: 'pat@example.com', password: '' })).toBeNull()
    expect(testAccountOf({ email: undefined, password: 'hunter2' })).toBeNull()
  })
})
