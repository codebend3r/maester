import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type Library, type LibraryInput, validateLibraryInput } from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from './LibraryDialog.module.scss'

/**
 * Creates a library, or edits one when `library` is given. A native modal
 * <dialog> handles focus trapping and Escape; closing hands focus back to
 * whatever opened it.
 */
export const LibraryDialog = ({ library, onClose }: { library?: Library; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = { name: useId(), errors: useId(), folders: useId() }
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(library?.name ?? '')
  const [paths, setPaths] = useState<string[]>(library?.paths ?? [])
  const [typedPath, setTypedPath] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.libraries })

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
    const result = validateLibraryInput({ name, paths })
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
