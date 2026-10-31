import { afterEach, mock } from 'bun:test'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// Bun test does not unmount between tests the way vitest globals do.
afterEach(() => {
  cleanup()
  mock.restore()
})
