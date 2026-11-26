import { cleanName } from '@raven/core'

/** What leaving Settings' name field does: refuse what was typed, keep the name, or save a new one. */
export const NAME_SAVES = { refused: 'refused', kept: 'kept', saved: 'saved' } as const

export type ServerNameSave =
  | { kind: typeof NAME_SAVES.refused }
  | { kind: typeof NAME_SAVES.kept }
  | { kind: typeof NAME_SAVES.saved; name: string }

type ServerNameSaveOfProps = {
  /** What is in the field. */
  text: string
  /** The name the account has for the server now. */
  current: string
}

/**
 * What the text typed comes to: a blank field or the name already worn keeps it, a clean new
 * name (`cleanName`'s tidying) is saved, and anything else is refused.
 */
export const serverNameSaveOf = ({ text, current }: ServerNameSaveOfProps): ServerNameSave => {
  if (text.trim() === '') return { kind: NAME_SAVES.kept }
  const name = cleanName(text)
  if (name === null) return { kind: NAME_SAVES.refused }
  return name === current ? { kind: NAME_SAVES.kept } : { kind: NAME_SAVES.saved, name }
}
