import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SAGA_BACKDROP_TYPES,
  SLIDESHOW_MOTIONS,
  type Saga,
  type SagaBackdrop,
  sagaCover,
  sagaPictures,
} from '@raven/core'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '@raven/ui'
import { api } from '@/lib/api'
import { useModal } from '@/lib/useModal'
import { afterSagaBackdrop } from '@raven/ui/headless'
import styles from '@/pages/SagaPage/SagaBackdropDialog.module.scss'

/** A way for the slideshow to go, or `off` for the cover held still. */
const CHOICES = { ...SLIDESHOW_MOTIONS, off: 'off' } as const

type Choice = (typeof CHOICES)[keyof typeof CHOICES]

const LABELS = {
  fade: { label: 'Crossfade', hint: 'Each picture fades into the next.' },
  kenBurns: { label: 'Ken Burns', hint: 'A slow zoom across each picture as it fades in.' },
  slide: { label: 'Slide', hint: 'Each picture slides in and pushes the last one out.' },
  off: { label: 'Off', hint: "One movie's backdrop, held still." },
} as const satisfies Record<Choice, { label: string; hint: string }>

type SagaBackdropDialogProps = {
  libraryId: number
  saga: Saga
  onClose: () => void
}

/**
 * Edit backdrop: whether a saga's page shows its movies' backdrops in turn,
 * and how each comes in, or holds its cover still, and which movie's that
 * is. A native modal <dialog> traps focus and closes on Escape.
 */
export const SagaBackdropDialog = ({ libraryId, saga, onClose }: SagaBackdropDialogProps) => {
  const { dialog } = useModal()
  const ids = { title: useId(), choice: useId(), cover: useId() }
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<Choice>(
    saga.backdrop.type === SAGA_BACKDROP_TYPES.slideshow ? saga.backdrop.motion : CHOICES.off,
  )
  // The cover the page shows, so a pick whose movie has left the saga starts
  // on the one standing in for it, and kept while the motions are tried.
  const [coverId, setCoverId] = useState(sagaCover(saga)?.id ?? null)

  const chosen = (): SagaBackdrop | null => {
    if (choice !== CHOICES.off) return { type: SAGA_BACKDROP_TYPES.slideshow, motion: choice }
    return coverId == null ? null : { type: SAGA_BACKDROP_TYPES.still, itemId: coverId }
  }

  const save = useMutation({
    mutationFn: (backdrop: SagaBackdrop) =>
      api.setSagaBackdrop({ libraryId, sagaId: saga.tmdbId, backdrop }),
    onSuccess: async () => {
      await afterSagaBackdrop({ queryClient, libraryId })
      dialog.current?.close()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const backdrop = chosen()
    if (backdrop) save.mutate(backdrop)
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={ids.title} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <h2 id={ids.title} className={styles.title}>
          Edit backdrop
        </h2>

        <fieldset className={styles.field}>
          <legend>Slideshow</legend>
          <p className={styles.hint}>
            Behind the title, each movie's backdrop in turn, first to last and round again.
          </p>
          {Object.values(CHOICES).map((each) => (
            <div key={each} className={styles.choice}>
              <input
                id={`${ids.choice}-${each}`}
                type="radio"
                name={ids.choice}
                checked={choice === each}
                disabled={each === CHOICES.off && coverId == null}
                onChange={() => setChoice(each)}
                aria-describedby={`${ids.choice}-${each}-hint`}
              />
              <label htmlFor={`${ids.choice}-${each}`}>{LABELS[each].label}</label>
              <p id={`${ids.choice}-${each}-hint`} className={styles.hint}>
                {LABELS[each].hint}
              </p>
            </div>
          ))}
        </fieldset>

        {choice === CHOICES.off && (
          <fieldset className={styles.field}>
            <legend>Picture</legend>
            <ul className={styles.pictures}>
              {sagaPictures(saga).map((picture) => (
                <li key={picture.id} className={styles.picture}>
                  <input
                    id={`${ids.cover}-${picture.id}`}
                    type="radio"
                    name={ids.cover}
                    className="visually-hidden"
                    checked={coverId === picture.id}
                    onChange={() => setCoverId(picture.id)}
                  />
                  <label htmlFor={`${ids.cover}-${picture.id}`}>
                    <img src={api.sagaPictureUrl(picture)} alt="" loading="lazy" decoding="async" />
                    <span className={styles.caption}>{picture.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {save.isError && (
          <p className={styles.error} role="alert">
            Could not save the backdrop: {save.error.message}
          </p>
        )}

        <div className={styles.actions}>
          <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={save.isPending || !chosen()}>
            Save
          </Button>
        </div>
      </form>
    </dialog>
  )
}
