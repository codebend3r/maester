import { expect, test } from 'bun:test'
import { messageOf } from '@/shared/messageOf'

test('an Error gives its message and anything else its string', () => {
  expect(messageOf(new Error('no addon'))).toBe('no addon')
  expect(messageOf('gone')).toBe('gone')
  expect(messageOf(42)).toBe('42')
})
