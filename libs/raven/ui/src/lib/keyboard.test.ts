import { describe, expect, it } from 'bun:test'
import { isInForeignDialog, isShortcut } from '@/lib/keyboard'

const press = ({
  key,
  target = document.body,
  ...held
}: {
  key: string
  target?: Element
} & Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat'>>) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...held })
  Object.defineProperty(event, 'target', { value: target })
  return isShortcut({ event, key: 'b' })
}

describe('isShortcut', () => {
  it('takes the key whatever its case', () => {
    expect(press({ key: 'b' })).toBe(true)
    expect(press({ key: 'B' })).toBe(true)
    expect(press({ key: 'n' })).toBe(false)
  })

  it('leaves a press with a modifier, or held down, alone', () => {
    expect(press({ key: 'b', metaKey: true })).toBe(false)
    expect(press({ key: 'b', ctrlKey: true })).toBe(false)
    expect(press({ key: 'b', altKey: true })).toBe(false)
    expect(press({ key: 'b', repeat: true })).toBe(false)
  })

  it('leaves form controls and dialogs their keys', () => {
    const input = document.createElement('input')
    const dialog = document.createElement('dialog')
    const button = document.createElement('button')
    dialog.append(button)
    expect(press({ key: 'b', target: input })).toBe(false)
    expect(press({ key: 'b', target: button })).toBe(false)
  })

  it('leaves a press something already handled', () => {
    const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true })
    event.preventDefault()
    expect(isShortcut({ event, key: 'b' })).toBe(false)
  })

  it('lets a checkbox through only when asked', () => {
    const box = document.createElement('input')
    box.type = 'checkbox'
    const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true })
    Object.defineProperty(event, 'target', { value: box })
    expect(isShortcut({ event, key: 'b' })).toBe(false)
    expect(isShortcut({ event, key: 'b', inCheckboxes: true })).toBe(true)
  })
})

describe('isInForeignDialog', () => {
  const build = () => {
    const root = document.createElement('div')
    const own = document.createElement('dialog')
    const ownButton = document.createElement('button')
    own.append(ownButton)
    root.append(own)
    const foreign = document.createElement('dialog')
    const field = document.createElement('input')
    foreign.append(field)
    const outside = document.createElement('button')
    document.body.append(root, foreign, outside)
    return { root, ownButton, field, outside }
  }

  it('is true for a key in a dialog outside the root only', () => {
    const { root, ownButton, field, outside } = build()
    expect(isInForeignDialog({ target: field, root })).toBe(true)
    expect(isInForeignDialog({ target: ownButton, root })).toBe(false)
    expect(isInForeignDialog({ target: outside, root })).toBe(false)
    expect(isInForeignDialog({ target: window, root })).toBe(false)
  })

  it('treats every dialog as foreign before the root has mounted', () => {
    const { ownButton } = build()
    expect(isInForeignDialog({ target: ownButton, root: null })).toBe(true)
  })
})
