import type { ChangeEvent, MouseEvent } from 'react'
import { useSelection, useSelectionScope } from '@/components/SelectionScope/SelectionScope'
import { ENTRY_SELECTOR } from '@/lib/useScrollReset'

/** The keys of the cards on show, in the order the page stacks them: what a range runs along. */
const keysOnPage = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(ENTRY_SELECTOR))
    // The selector already leaves out a closed bucket's cards; happy-dom, which the tests run in, cannot match a nested :not().
    .filter((card) => !card.closest('details:not([open])'))
    .map((card) => card.dataset.entry ?? '')

/**
 * What a card needs to be selected: `rootProps` for its outermost element,
 * which has `data-entry={key}`, a `linkTabIndex` for its links, and the
 * props of its checkbox. Inside a scope that is selecting, a click anywhere
 * on the card selects it and goes no further, so no link follows it. Outside
 * a scope the card is as it was, and has no checkbox.
 */
export const useSelectable = ({ key, title }: { key: string; title: string }) => {
  const scope = useSelectionScope()
  const selecting = useSelection((state) => state.selecting)
  const selected = useSelection((state) => state.keys.has(key))

  const onClickCapture = (event: MouseEvent) => {
    const state = scope?.store.getState()
    if (!state?.selecting) return
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey) state.range({ to: key, ordered: keysOnPage() })
    else state.toggle(key)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const state = scope?.store.getState()
    if (!state) return
    if (event.target.checked && !state.selecting) state.start(key)
    else state.toggle(key)
  }

  return {
    isAvailable: scope !== null,
    selecting,
    selected,
    rootProps: {
      onClickCapture,
      'data-selecting': selecting ? 'true' : undefined,
      'data-selected': selected ? 'true' : undefined,
    },
    /** One tab stop per card while selecting: its checkbox, not its links. */
    linkTabIndex: selecting ? -1 : undefined,
    checkboxProps: {
      checked: selected,
      'aria-label': `Select ${title}`,
      onChange,
      // Thousands of cards must not add thousands of tab stops outside select mode.
      tabIndex: selecting ? 0 : -1,
    },
  }
}

export type Selectable = ReturnType<typeof useSelectable>
