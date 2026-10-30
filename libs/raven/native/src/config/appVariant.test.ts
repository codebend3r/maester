import { describe, expect, it } from 'bun:test'

import { APP_VARIANTS, isDevelopmentVariant } from '@/config/appVariant'

describe('isDevelopmentVariant', () => {
  it('is true only for the development variant', () => {
    expect(isDevelopmentVariant({ variant: APP_VARIANTS.development })).toBe(true)
    expect(isDevelopmentVariant({ variant: ' development ' })).toBe(true)
  })

  it.each([[undefined], [''], ['production'], ['Development'], ['dev']])(
    'keeps a release build strict for %p',
    (variant) => {
      expect(isDevelopmentVariant({ variant })).toBe(false)
    },
  )
})
