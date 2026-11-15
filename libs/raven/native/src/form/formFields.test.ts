import { describe, expect, it } from 'bun:test'

import { keyboardFor } from '@/form/formFields'

describe('keyboardFor', () => {
  it('opens digits for a number, the email keyboard for an email, and plain for a password', () => {
    expect(keyboardFor({ isSecret: false, isEmail: false, isNumber: true })).toBe('decimal-pad')
    expect(keyboardFor({ isSecret: false, isEmail: true, isNumber: false })).toBe('email-address')
    expect(keyboardFor({ isSecret: true, isEmail: false, isNumber: false })).toBe('default')
    expect(keyboardFor({ isSecret: false, isEmail: false, isNumber: false })).toBe('url')
  })
})
