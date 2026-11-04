import { describe, expect, it, spyOn } from 'bun:test'
import { applyStylesheets } from '@/lib/applyStylesheets'

type HeadProps = { links: readonly string[] }

/** Links outside any document, which happy-dom never fetches, so each test fires their events. */
const headWith = ({ links }: HeadProps): HTMLElement => {
  const head = document.createElement('head')
  head.innerHTML = links.join('')
  return head
}

const PRELOAD = '<link rel="preload" as="style" href="/assets/style.css">'

const settled = (promise: Promise<void>) =>
  Promise.race([promise.then(() => true), Bun.sleep(20).then(() => false)])

describe('applyStylesheets', () => {
  it('makes each preloaded stylesheet a stylesheet and waits until it loads', async () => {
    const head = headWith({ links: [PRELOAD] })
    const applying = applyStylesheets({ root: head })
    const link = head.querySelector('link')
    expect(link?.rel).toBe('stylesheet')
    expect(await settled(applying)).toBe(false)
    link?.dispatchEvent(new Event('load'))
    expect(await settled(applying)).toBe(true)
  })

  it('lets the app render when a stylesheet fails', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    const head = headWith({ links: [PRELOAD] })
    const applying = applyStylesheets({ root: head })
    head.querySelector('link')?.dispatchEvent(new Event('error'))
    expect(await settled(applying)).toBe(true)
    expect(quiet).toHaveBeenCalledTimes(1)
    quiet.mockRestore()
  })

  it('leaves other preloads alone and settles at once with no stylesheet to wait for', async () => {
    const head = headWith({ links: ['<link rel="preload" as="font" href="/assets/font.woff2">'] })
    expect(await settled(applyStylesheets({ root: head }))).toBe(true)
    expect(head.querySelector('link')?.rel).toBe('preload')
  })
})
