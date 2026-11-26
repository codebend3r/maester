/** A tab: its value, its label and, where it lists things, how many it holds. */
export type TabEntry<T extends string> = { value: T; label: string; count?: number }
