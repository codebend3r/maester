import { PLAYLIST_LIMITS, isPlaylistName } from '@raven/core'
import { Button } from '@raven/ui'
import { type FormEvent, useId, useState } from 'react'
import { useModal } from '@/lib/useModal'
import styles from '@/components/PlaylistNameDialog/PlaylistNameDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type PlaylistNameDialogProps = {
  /** The dialog's heading: "New playlist", "Rename playlist". */
  title: string
  /** What the field holds as it opens: '' for a new playlist, the name for a rename. */
  initialName: string
  /** What the button that saves says. */
  submitLabel: string
  isPending: boolean
  /** Why the server refused the last try; null for none. */
  error: Error | null
  onSubmit: (name: string) => void
  onClose: () => void
}

/** A playlist's name, asked for as one is made or renamed; a name of only spaces saves nothing. */
export const PlaylistNameDialog = ({
  title,
  initialName,
  submitLabel,
  isPending,
  error,
  onSubmit,
  onClose,
}: PlaylistNameDialogProps) => {
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const fieldId = useId()
  const [name, setName] = useState(initialName)
  const isValid = isPlaylistName(name)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isValid) onSubmit(name.trim())
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <form className={styles.body} onSubmit={submit}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.field}>
          <label htmlFor={fieldId}>{COMMON_COPY.name}</label>
          <input
            id={fieldId}
            value={name}
            maxLength={PLAYLIST_LIMITS.name}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error !== null && (
          <p role="alert" className={styles.error}>
            {error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          <Button tone="primary" type="submit" disabled={!isValid || isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
