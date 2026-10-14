import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type Saga,
  type SagaBackdrop,
  type SlideshowMotion,
  isSlideshowMotion,
  sagaBackdrop,
  sagaPictures,
} from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { afterSagaBackdrop } from '@/lib/invalidate'
import styles from '@/pages/SagaPage/SagaBackdropDialog.module.scss'

/** Each way the slideshow can move, as the dialog offers it. */
const MOTIONS = {
  fade: { label: 'Crossfade', hint: 'Each picture fades into the next.' },
  kenBurns: { label: 'Ken Burns', hint: 'A slow zoom across each picture as it fades in.' },
  slide: { label: 'Slide', hint: 'Each picture slides in and pushes the last one out.' },
} as const satisfies Record<SlideshowMotion, { label: string; hint: string }>

/**
 * Edit backdrop: whether a saga's page shows its movies' backdrops in turn,
 * and how each comes in, or holds one of them still, and which. A native
 * modal <dialog> traps focus and closes on Escape.
 */
export const SagaBackdropDialog = ({
  libraryId,
  saga,
  onClose,
}: {
  libraryId: number
  saga: Saga
  onClose: () => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { title: useId(), motion: useId(), picture: useId() }
  const queryClient = useQueryClient()
  const [backdrop, setBackdrop] = useState<SagaBackdrop>(saga.backdrop)
  // Turning the slideshow off holds still the picture that stands for the saga now.
  const standing = sagaBackdrop({ ...saga, backdrop })

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const holdStill = () => {
    if (standing) setBackdrop({ type: 'still', itemId: standing.id })
  }

  const save = useMutation({
    mutationFn: (picked: SagaBackdrop) =>
      api.setSagaBackdrop({ libraryId, sagaId: saga.tmdbId, backdrop: picked }),
    onSuccess: async () => {
      await afterSagaBackdrop({ queryClient, libraryId })
      dialog.current?.close()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(backdrop)
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
          {isSlideshowMotion.values.map((motion) => (
            <div key={motion} className={styles.choice}>
              <input
                id={`${ids.motion}-${motion}`}
                type="radio"
                name={ids.motion}
                checked={backdrop.type === 'slideshow' && backdrop.motion === motion}
                onChange={() => setBackdrop({ type: 'slideshow', motion })}
                aria-describedby={`${ids.motion}-${motion}-hint`}
              />
              <label htmlFor={`${ids.motion}-${motion}`}>{MOTIONS[motion].label}</label>
              <p id={`${ids.motion}-${motion}-hint`} className={styles.hint}>
                {MOTIONS[motion].hint}
              </p>
            </div>
          ))}
          <div className={styles.choice}>
            <input
              id={`${ids.motion}-off`}
              type="radio"
              name={ids.motion}
              checked={backdrop.type === 'still'}
              disabled={!standing}
              onChange={holdStill}
              aria-describedby={`${ids.motion}-off-hint`}
            />
            <label htmlFor={`${ids.motion}-off`}>Off</label>
            <p id={`${ids.motion}-off-hint`} className={styles.hint}>
              One movie's backdrop, held still.
            </p>
          </div>
        </fieldset>

        {backdrop.type === 'still' && (
          <fieldset className={styles.field}>
            <legend>Picture</legend>
            <ul className={styles.pictures}>
              {sagaPictures(saga).map((picture) => (
                <li key={picture.id} className={styles.picture}>
                  <input
                    id={`${ids.picture}-${picture.id}`}
                    type="radio"
                    name={ids.picture}
                    className="visually-hidden"
                    checked={backdrop.itemId === picture.id}
                    onChange={() => setBackdrop({ type: 'still', itemId: picture.id })}
                  />
                  <label htmlFor={`${ids.picture}-${picture.id}`}>
                    <img
                      src={
                        api.itemImageUrl({
                          id: picture.id,
                          kind: 'backdrop',
                          version: picture.version,
                        }) ?? undefined
                      }
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
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
          <Button type="submit" tone="primary" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </dialog>
  )
}
