import { create } from 'zustand'

/** Whether a search field on screen holds the focus, so the header fades the page's top under it. */
export const useSearchFocus = create<{ isFocused: boolean }>()(() => ({ isFocused: false }))
