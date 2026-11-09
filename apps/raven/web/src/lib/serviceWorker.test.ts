import { describe, expect, mock, test } from 'bun:test'
import { SERVICE_WORKER } from '@raven/core'
import { startServiceWorker } from '@/lib/serviceWorker'

const containerWith = () => {
  const register = mock(() => Promise.resolve())
  return { register, container: { register } }
}

type FakePageProps = { readyState: DocumentReadyState }

const fakePage = ({ readyState }: FakePageProps) => {
  const { register, container } = containerWith()
  const listeners = new Map<string, () => void>()
  return {
    register,
    listeners,
    target: {
      navigator: { serviceWorker: container },
      document: { readyState },
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      },
    },
  }
}

describe('startServiceWorker', () => {
  test('waits for the page to load before registering', () => {
    const page = fakePage({ readyState: 'loading' })
    startServiceWorker({ target: page.target, isProduction: true, isDesktop: false })
    expect(page.register).not.toHaveBeenCalled()
    page.listeners.get('load')?.()
    expect(page.register).toHaveBeenCalledTimes(1)
  })

  test('registers the worker at the root at once on a page that has loaded', () => {
    const page = fakePage({ readyState: 'complete' })
    startServiceWorker({ target: page.target, isProduction: true, isDesktop: false })
    expect(page.register).toHaveBeenCalledTimes(1)
    expect(page.register).toHaveBeenCalledWith(SERVICE_WORKER.path, {
      scope: SERVICE_WORKER.scope,
    })
  })

  test('never registers in development or in Raven', () => {
    const dev = fakePage({ readyState: 'complete' })
    startServiceWorker({ target: dev.target, isProduction: false, isDesktop: false })
    const desktop = fakePage({ readyState: 'complete' })
    startServiceWorker({ target: desktop.target, isProduction: true, isDesktop: true })
    expect(dev.register).not.toHaveBeenCalled()
    expect(desktop.register).not.toHaveBeenCalled()
  })

  test('does nothing where the browser has no workers', () => {
    const page = fakePage({ readyState: 'complete' })
    const target = { ...page.target, navigator: {} }
    expect(() => startServiceWorker({ target, isProduction: true, isDesktop: false })).not.toThrow()
  })
})
