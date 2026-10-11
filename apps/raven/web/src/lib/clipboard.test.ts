import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { copyText } from '@/lib/clipboard'

const secure = (isSecureContext: boolean) =>
  Object.defineProperty(window, 'isSecureContext', { value: isSecureContext, configurable: true })

describe('copyText', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'isSecureContext')
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('uses the Clipboard API where the page may', async () => {
    secure(true)
    const copied: string[] = []
    const write = spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copied.push(text)
    })
    expect(await copyText('/media/a.mkv')).toBe(true)
    write.mockRestore()
    expect(copied).toEqual(['/media/a.mkv'])
  })

  it('copies from a selection over plain HTTP, leaving nothing behind', async () => {
    secure(false)
    const selected: string[] = []
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        const area = document.querySelector('textarea')
        selected.push(`${command}:${area?.value ?? ''}`)
        return true
      },
    })
    expect(await copyText('/media/a.mkv')).toBe(true)
    expect(selected).toEqual(['copy:/media/a.mkv'])
    expect(document.querySelector('textarea')).toBeNull()
  })
})
