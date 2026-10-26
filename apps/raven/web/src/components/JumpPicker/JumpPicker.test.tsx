import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { type JumpScale, jumpScale } from '@raven/core'
import { JumpPicker } from '@/components/JumpPicker/JumpPicker'
import { mediaItem } from '@/test/fixtures'
import { pageWithoutLayout } from '@/test/scrolling'

const HEAT = mediaItem({ id: 1, title: 'Heat', item: null, bitrate: 72_000_000 })
const CLIP = mediaItem({ id: 2, title: 'Lost Clip', item: null, bitrate: 8_000_000 })

type PageProps = { scale: JumpScale | null }

/**
 * Cards in a page, one folded away in a bucket, with the picker beside them.
 * Each card leads with its picture's link, kept from the keyboard as the
 * real cards keep it, before the title's.
 */
const Page = ({ scale }: PageProps) => {
  const scope = useRef<HTMLDivElement>(null)
  return (
    <div ref={scope}>
      <ul>
        <li data-entry="media:1">
          <a href="/movies/1" tabIndex={-1} aria-hidden="true">
            <img src="/heat.jpg" alt="" />
          </a>
          <a href="/movies/1">Heat</a>
        </li>
      </ul>
      <details>
        <summary>Not matched</summary>
        <ul>
          <li data-entry="media:2">
            <a href="/watch/2" tabIndex={-1} aria-hidden="true">
              <img src="/clip.jpg" alt="" />
            </a>
            <a href="/watch/2">Lost Clip</a>
          </li>
        </ul>
      </details>
      {scale && <JumpPicker scale={scale} scope={scope} />}
    </div>
  )
}

const byTitle = jumpScale({ sort: 'title', files: [HEAT, CLIP], source: 'tmdb' })
const byBitrate = jumpScale({ sort: 'bitrate-high', files: [HEAT, CLIP], source: 'tmdb' })

describe('JumpPicker', () => {
  const scrolled: string[] = []
  const record = function (this: HTMLElement) {
    scrolled.push(this.textContent ?? '')
  }
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(record)
  const cleanups: Array<() => void> = []

  afterEach(() => {
    scrolled.length = 0
    scroll.mockClear()
    scroll.mockImplementation(record)
    cleanups.splice(0).forEach((cleanup) => cleanup())
  })

  it('offers every letter for a title order, pressable only where a card starts with it', () => {
    render(<Page scale={byTitle} />)
    const picker = within(screen.getByRole('navigation', { name: 'Jump to a letter' }))
    const buttons = picker.getAllByRole('button')
    expect(buttons).toHaveLength(27)
    expect(buttons[0]).toHaveAccessibleName('Numbers and symbols')
    expect(picker.getByRole('button', { name: 'H' })).toBeEnabled()
    expect(picker.getByRole('button', { name: 'A' })).toBeDisabled()
  })

  it('steps through the bitrate under its unit for a bitrate order', () => {
    render(<Page scale={byBitrate} />)
    const picker = screen.getByRole('navigation', { name: 'Jump to a bitrate' })
    expect(within(picker).getByText('Mb/s')).toBeInTheDocument()
    const buttons = within(picker).getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('70')
    expect(buttons[0]).toHaveAccessibleName('70 to 75 Mb/s')
    expect(buttons.at(-1)).toHaveTextContent('5')
    expect(within(picker).getByRole('button', { name: '40 to 45 Mb/s' })).toBeDisabled()
  })

  it('brings the first card under a mark into view and hands it the focus', async () => {
    render(<Page scale={byBitrate} />)
    await userEvent.click(screen.getByRole('button', { name: '70 to 75 Mb/s' }))
    expect(scrolled).toEqual(['Heat'])
    expect(screen.getByRole('link', { name: 'Heat' })).toHaveFocus()
  })

  it('keeps the card at the top while the cards drawn on the way move it', async () => {
    const page = pageWithoutLayout()
    cleanups.push(page.restore)
    // The browser scrolls the card to the top of the screen, wherever it stands then.
    scroll.mockImplementation(function (this: HTMLElement) {
      page.scrollTo(window.scrollY + this.getBoundingClientRect().top)
    })
    render(<Page scale={byTitle} />)
    const card = screen.getByRole('link', { name: 'Heat' }).closest('li')
    if (!card) throw new Error('no card for Heat')
    page.place({ element: card, top: 4000 })
    await userEvent.click(screen.getByRole('button', { name: 'H' }))
    expect(card.getBoundingClientRect().top).toBe(0)
    // Drawn now, the cards above it are taller than they stood in at.
    page.place({ element: card, top: 4120 })
    page.frame(12)
    expect(card.getBoundingClientRect().top).toBe(0)
  })

  it('opens the folded bucket a card sits in first', async () => {
    render(<Page scale={byTitle} />)
    await userEvent.click(screen.getByRole('button', { name: 'L' }))
    expect(document.querySelector('details')?.open).toBe(true)
    expect(scrolled).toEqual(['Lost Clip'])
    expect(screen.getByRole('link', { name: 'Lost Clip' })).toHaveFocus()
  })
})
