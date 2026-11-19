import { create } from 'zustand'

/** One line of a choice sheet, its `key` unique on the sheet, and what choosing it does. */
type SheetOption = { key: string; label: string; isDestructive: boolean; onPress: () => void }

/** A list to choose one line from, or Cancel, which chooses nothing. */
export type ChoiceSheet = {
  title: string
  /** A line under the title: why an action is not offered. */
  message: string | null
  options: readonly SheetOption[]
  /** Dark over the video, whatever the theme, as the player's own pickers are. */
  isOverPicture: boolean
}

/** A field to type a name in, sent by its button or the keyboard's own. */
export type PromptSheet = {
  title: string
  initial: string
  submit: string
  onSubmit: (value: string) => void
}

export const DRAWN_SHEETS = { choice: 'choice', prompt: 'prompt' } as const

type DrawnSheet =
  | ({ kind: typeof DRAWN_SHEETS.choice } & ChoiceSheet)
  | ({ kind: typeof DRAWN_SHEETS.prompt } & PromptSheet)

type DrawnSheetState = {
  sheet: DrawnSheet | null
  show: (sheet: DrawnSheet) => void
  close: () => void
}

/**
 * The sheet raven draws open where the system has none, read by `DrawnSheetHost` above the
 * routes. One is open at a time: asking for one puts it in the other's place, as the system's would.
 */
export const useDrawnSheet = create<DrawnSheetState>()((set) => ({
  sheet: null,
  show: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}))
