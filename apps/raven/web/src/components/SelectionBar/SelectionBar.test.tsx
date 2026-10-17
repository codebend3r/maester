import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { MAX_WATCH_TARGETS, type WatchTarget } from '@raven/core'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectCheckbox } from '@/components/SelectCheckbox/SelectCheckbox'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { api } from '@/lib/api'
import { useSelectable } from '@/lib/useSelectable'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { Peek, peeked } from '@/test/selection'

const Card = ({ id }: { id: string }) => {
  const select = useSelectable({ key: id, title: id })
  return (
    <li data-entry={id} {...select.rootProps}>
      <a href="#open" tabIndex={select.linkTabIndex}>
        {id}
      </a>
      <SelectCheckbox select={select} />
    </li>
  )
}

const TARGETS: [string, WatchTarget[]][] = [
  ['media:1', [{ kind: 'media', id: 1 }]],
  ['show:4', [{ kind: 'item', id: 4, libraryId: 7 }]],
  [
    'saga:9',
    [
      { kind: 'item', id: 20, libraryId: 7 },
      { kind: 'media', id: 21 },
    ],
  ],
]

const setUp = (entries: [string, WatchTarget[]][] = TARGETS) =>
  renderWithProviders(
    <SelectionScope {...sourceOf(entries)}>
      <Peek />
      <SelectButton />
      <ul>
        {entries.slice(0, 2).map(([key]) => (
          <Card key={key} id={key} />
        ))}
      </ul>
      <details>
        <summary>Folded</summary>
        <ul>
          <Card id="saga:9" />
        </ul>
      </details>
      <SelectionBar />
    </SelectionScope>,
  )

const selectMode = () => userEvent.click(screen.getByRole('button', { name: 'Select' }))
const bar = () => screen.getByRole('region', { name: 'Selection' })
const picked = (): string[] => [...(peeked.scope?.store.getState().keys ?? [])].toSorted()

describe('SelectionBar', () => {
  const spy = spyOn(api, 'setWatched')

  afterEach(() => {
    spy.mockReset()
  })

  it('is not there until select mode starts', async () => {
    setUp()
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument()
    await selectMode()
    expect(bar()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says how many are selected, politely', async () => {
    setUp()
    await selectMode()
    const count = within(bar()).getByRole('status')
    expect(count.tagName).toBe('OUTPUT')
    expect(count).toHaveTextContent('0 selected')
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    expect(count).toHaveTextContent('1 selected')
  })

  it('selects every key the scope holds on Select all, closed buckets included', async () => {
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(picked()).toEqual(['media:1', 'saga:9', 'show:4'])
    expect(within(bar()).getByRole('status')).toHaveTextContent('3 selected')
  })

  it('disables both marks with nothing selected', async () => {
    setUp()
    await selectMode()
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mark unwatched' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeEnabled()
  })

  it('sends every selected card in one request and says what it marked', async () => {
    spy.mockResolvedValue(undefined)
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('Marked 3 watched'),
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      watched: true,
      targets: [
        { kind: 'media', id: 1 },
        { kind: 'item', id: 4, libraryId: 7 },
        { kind: 'item', id: 20, libraryId: 7 },
        { kind: 'media', id: 21 },
      ],
    })
  })

  it('keeps the selection after marking, and Mark unwatched reverses it', async () => {
    spy.mockResolvedValue(undefined)
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('Marked 1 watched'),
    )
    expect(picked()).toEqual(['media:1'])
    await userEvent.click(screen.getByRole('button', { name: 'Mark unwatched' }))
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('Marked 1 unwatched'),
    )
    expect(spy).toHaveBeenLastCalledWith({
      watched: false,
      targets: [{ kind: 'media', id: 1 }],
    })
  })

  it('forgets the outcome once the selection changes', async () => {
    spy.mockResolvedValue(undefined)
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() =>
      expect(within(bar()).getByRole('status')).toHaveTextContent('Marked 1 watched'),
    )
    await userEvent.click(screen.getByRole('link', { name: 'show:4' }))
    expect(within(bar()).getByRole('status')).toHaveTextContent('2 selected')
    expect(within(bar()).getByRole('status')).not.toHaveTextContent('Marked')
  })

  it('shows an alert for a failed mark and keeps the selection', async () => {
    spy.mockRejectedValue(new Error('no'))
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not mark. Try again.')
    expect(picked()).toEqual(['media:1'])
    expect(within(bar()).getByRole('status')).not.toHaveTextContent('Marked')
  })

  it('sends a selection of more than the server takes in parts', async () => {
    spy.mockResolvedValue(undefined)
    const many: [string, WatchTarget[]][] = Array.from(
      { length: MAX_WATCH_TARGETS + 1 },
      (_, id) => [`media:${id}`, [{ kind: 'media', id }]],
    )
    setUp(many)
    await selectMode()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark watched' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy.mock.calls.map(([change]) => change.targets.length)).toEqual([MAX_WATCH_TARGETS, 1])
  })

  it('empties the selection on Clear and stays in select mode', async () => {
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('link', { name: 'media:1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(picked()).toEqual([])
    expect(bar()).toBeInTheDocument()
  })

  it('ends select mode on Done and puts the focus back on Select', async () => {
    setUp()
    await selectMode()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('ends select mode on Escape, even from a card checkbox, and puts the focus back on Select', async () => {
    setUp()
    await selectMode()
    await userEvent.tab()
    expect(screen.getByRole('checkbox', { name: 'Select media:1' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus()
  })

  it('leaves Escape to an open dialog first', async () => {
    renderWithProviders(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <SelectButton />
        <SelectionBar />
        <dialog open>
          <button type="button">Inside</button>
        </dialog>
      </SelectionScope>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    screen.getByRole('button', { name: 'Inside' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(bar()).toBeInTheDocument()
    screen.getByRole('button', { name: 'Done' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument()
  })

  it('leaves Escape to whatever handled it already', async () => {
    renderWithProviders(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <SelectButton />
        <SelectionBar />
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Handles it
        </button>
      </SelectionScope>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    screen.getByRole('button', { name: 'Handles it' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(bar()).toBeInTheDocument()
  })

  it('leaves a right click to the browser while selecting', async () => {
    renderWithProviders(
      <SelectionScope {...sourceOf([])}>
        <Peek />
        <ul>
          <MediaCard media={mediaItem({ id: 5, title: 'Pilot' })} />
        </ul>
      </SelectionScope>,
    )
    act(() => peeked.scope?.store.getState().start())
    const proceeded = fireEvent.contextMenu(screen.getByRole('link', { name: 'Pilot' }))
    expect(proceeded).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('ends select mode when Select is pressed again', async () => {
    setUp()
    await selectMode()
    await selectMode()
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument()
  })
})
