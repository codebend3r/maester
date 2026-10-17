import { describe, expect, it } from 'bun:test'
import { watchedLabel } from '@/renderer/desktop/watched'

describe('watchedLabel', () => {
  it('rounds the share to a percent', () => {
    expect(watchedLabel(0.333)).toBe('33% watched')
  })

  it('says Not started when there is no share', () => {
    expect(watchedLabel(null)).toBe('Not started')
  })
})
