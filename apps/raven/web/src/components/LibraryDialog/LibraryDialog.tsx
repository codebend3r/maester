import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_LIBRARY_SETTINGS,
  type Library,
  type LibraryInput,
  type LibrarySettings,
  validateLibraryInput,
} from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/components/LibraryDialog/LibraryDialog.module.scss'

/**
 * Creates a library, or edits one when `library` is given. A native modal
 * <dialog> handles focus trapping and Escape; closing hands focus back to
 * whatever opened it.
 */
export const LibraryDialog = ({ library, onClose }: { library?: Library; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { name: useId(), errors: useId(), folders: useId(), settings: useId() }
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(library?.name ?? '')
  const [paths, setPaths] = useState<string[]>(library?.paths ?? [])
  const [settings, setSettings] = useState<LibrarySettings>(
    library?.settings ?? DEFAULT_LIBRARY_SETTINGS,
  )
  const [typedPath, setTypedPath] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  // Saved spots show or hide with the library's progress setting, so cached
  // videos and favourites are refetched along with the libraries.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
      queryClient.invalidateQueries({ queryKey: ['media'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.favourites }),
    ])

  const save = useMutation({
    mutationFn: (input: LibraryInput) =>
      library ? api.updateLibrary({ id: library.id, input }) : api.createLibrary(input),
    onSuccess: async (saved) => {
      await refresh()
      onClose()
      if (!library) navigate(`/libraries/${saved.id}`)
    },
    onError: (error) => setErrors([error.message]),
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLibrary(id),
    onSuccess: async () => {
      await refresh()
      onClose()
      navigate('/')
    },
    onError: (error) => setErrors([error.message]),
  })

  const addPath = (path: string) => {
    setPaths((current) => (current.includes(path) ? current : [...current, path]))
    setErrors([])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = validateLibraryInput({ name, paths, settings })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    save.mutate(result.value)
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${ids.name}-title`}
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <h2 id={`${ids.name}-title`} className={styles.title}>
          {library ? 'Edit library' : 'Add a library'}
        </h2>

        <div className={styles.field}>
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Movies"
            autoComplete="off"
            aria-describedby={errors.length > 0 ? ids.errors : undefined}
          />
        </div>

        <fieldset className={styles.field} aria-describedby={ids.folders}>
          <legend>Folders</legend>
          <p id={ids.folders} className={styles.hint}>
            Every video in these folders and the folders inside them joins the library.
          </p>
          {paths.length > 0 && (
            <ul className={styles.paths}>
              {paths.map((path) => (
                <li key={path} className={styles.pathRow}>
                  <span className={styles.pathText}>{path}</span>
                  <Button
                    icon="close"
                    aria-label={`Remove ${path}`}
                    onClick={() => setPaths((current) => current.filter((item) => item !== path))}
                  />
                </li>
              ))}
            </ul>
          )}
          <FolderBrowser onChoose={addPath} exclude={paths} />
          <div className={styles.typed}>
            <label htmlFor={`${ids.folders}-typed`} className="visually-hidden">
              Folder path
            </label>
            <input
              id={`${ids.folders}-typed`}
              className={styles.input}
              value={typedPath}
              onChange={(event) => setTypedPath(event.target.value)}
              placeholder="Or type a path, like /media/movies"
              autoComplete="off"
            />
            <Button
              icon="plus"
              disabled={typedPath.trim() === ''}
              onClick={() => {
                addPath(typedPath.trim())
                setTypedPath('')
              }}
            >
              Add
            </Button>
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>Settings</legend>
          <div className={styles.setting}>
            <input
              id={`${ids.settings}-progress`}
              type="checkbox"
              className={styles.checkbox}
              checked={settings.saveProgress}
              onChange={(event) =>
                setSettings((current) => ({ ...current, saveProgress: event.target.checked }))
              }
              aria-describedby={`${ids.settings}-progress-hint`}
            />
            <label htmlFor={`${ids.settings}-progress`}>Save where each video stopped</label>
            <p id={`${ids.settings}-progress-hint`} className={styles.settingHint}>
              Leave a video and come back to pick up where you stopped. Turning this off keeps saved
              spots for later.
            </p>
          </div>
          <div className={styles.setting}>
            <input
              id={`${ids.settings}-pinned`}
              type="checkbox"
              className={styles.checkbox}
              checked={settings.pinned}
              onChange={(event) =>
                setSettings((current) => ({ ...current, pinned: event.target.checked }))
              }
              aria-describedby={`${ids.settings}-pinned-hint`}
            />
            <label htmlFor={`${ids.settings}-pinned`}>Pin to the side menu</label>
            <p id={`${ids.settings}-pinned-hint`} className={styles.settingHint}>
              Pinned libraries get their own link in the side menu.
            </p>
          </div>
          <div className={styles.watched}>
            <label htmlFor={`${ids.settings}-watched`}>Watched at</label>
            <span className={styles.percent}>
              <input
                id={`${ids.settings}-watched`}
                type="number"
                inputMode="numeric"
                className={styles.input}
                min={1}
                max={100}
                step={1}
                value={Number.isNaN(settings.watchedPercent) ? '' : settings.watchedPercent}
                onChange={(event) => {
                  const typed = event.target.value
                  setSettings((current) => ({
                    ...current,
                    watchedPercent: typed === '' ? Number.NaN : Number(typed),
                  }))
                }}
                aria-describedby={`${ids.settings}-watched-hint`}
              />
              <span aria-hidden="true">%</span>
            </span>
            <p id={`${ids.settings}-watched-hint`} className={styles.settingHint}>
              A video counts as watched in the library's history once playback gets this far through
              it.
            </p>
          </div>
        </fieldset>

        {errors.length > 0 && (
          <ul id={ids.errors} className={styles.errors} role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className={styles.actions}>
          {!!library && (
            <Button
              tone="danger"
              icon="trash"
              className={styles.delete}
              disabled={remove.isPending}
              onClick={() =>
                confirmingDelete ? remove.mutate(library.id) : setConfirmingDelete(true)
              }
            >
              {confirmingDelete ? 'Delete for good' : 'Delete library'}
            </Button>
          )}
          <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={save.isPending}>
            {library ? 'Save changes' : 'Add library'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
