import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_LIBRARY_SETTINGS,
  LIBRARY_KINDS,
  type Library,
  type LibraryInput,
  type LibraryKind,
  type LibrarySettings,
  type PathLayout,
  RATING_SOURCES,
  type RatingSource,
  defaultLibrarySettings,
  isRatingSource,
  matchTypeFor,
  validateLibraryInput,
  withLibraryKind,
} from '@raven/core'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser'
import { IconPicker } from '@/components/LibraryDialog/IconPicker'
import { api } from '@/lib/api'
import { KINDS, libraryIconOf } from '@/lib/libraryKinds'
import { afterLibrarySaved } from '@/lib/invalidate'
import { lockQuery, metadataHealthQuery } from '@/lib/queries'
import styles from '@/components/LibraryDialog/LibraryDialog.module.scss'

const RATINGS_LABELS: Record<RatingSource, string> = {
  tmdb: 'TMDB',
  imdb: 'IMDb',
  rottenTomatoes: 'Rotten Tomatoes',
  metacritic: 'Metacritic',
}

/** What Edit library calls each way a path was read. */
const pathLayoutLabel = ({
  layout,
  groups,
}: {
  layout: PathLayout | null
  groups: number
}): string => {
  if (layout == null) return 'not scanned yet'
  if (layout === 'flat') return 'one folder per title'
  return layout === 'lettered' ? `letter folders (${groups})` : `group folders (${groups})`
}

/**
 * Creates a library, or edits one when `library` is given. A native modal
 * <dialog> handles focus trapping and Escape; closing hands focus back to
 * whatever opened it.
 */
export const LibraryDialog = ({ library, onClose }: { library?: Library; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const ids = {
    name: useId(),
    errors: useId(),
    folders: useId(),
    settings: useId(),
    kind: useId(),
    icon: useId(),
  }
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
  const metadata = useQuery(metadataHealthQuery)
  // `off` is exactly "no key": a key that fails is the health check's to report.
  const isAiOff = metadata.data?.ai === 'off'
  const lock = useQuery(lockQuery)
  const lockable = !!lock.data?.available

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const refresh = () => afterLibrarySaved(queryClient)

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
      navigate('/libraries')
    },
    onError: (error) => setErrors([error.message]),
  })

  // A new library takes the view and grouping its type starts with; one
  // being edited keeps its own where the new type can show them.
  const pickKind = (kind: LibraryKind) =>
    setSettings((current) => {
      if (library) return withLibraryKind({ settings: current, kind })
      const { view, groupBy } = defaultLibrarySettings(kind)
      return { ...current, kind, view, groupBy }
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

        <fieldset
          className={styles.field}
          aria-describedby={isAiOff ? `${ids.kind}-hint ${ids.kind}-ai-hint` : `${ids.kind}-hint`}
        >
          <legend>Type</legend>
          <div className={styles.kinds}>
            {LIBRARY_KINDS.map((kind) => (
              <div key={kind} className={styles.kind}>
                <input
                  id={`${ids.kind}-${kind}`}
                  type="radio"
                  name={ids.kind}
                  value={kind}
                  checked={settings.kind === kind}
                  onChange={() => pickKind(kind)}
                />
                <label htmlFor={`${ids.kind}-${kind}`}>{KINDS[kind].label}</label>
              </div>
            ))}
          </div>
          <p id={`${ids.kind}-hint`} className={styles.hint}>
            {metadata.data?.tmdb === 'off' ? (
              <>
                Set <code>TMDB_API_TOKEN</code> in raven's <code>.env</code> for posters and
                details.
              </>
            ) : (
              'Movies, TV shows, anime, family, documentaries and sporting events get posters and details from TMDB.'
            )}
          </p>
          {isAiOff && (
            <p id={`${ids.kind}-ai-hint`} className={styles.hint}>
              Set <code>ANTHROPIC_API_KEY</code> in raven's <code>.env</code> to look up titles the
              matcher misses.
            </p>
          )}
        </fieldset>

        <fieldset className={styles.field} aria-describedby={`${ids.icon}-hint`}>
          <legend>Icon</legend>
          <IconPicker
            value={libraryIconOf(settings)}
            onChange={(icon) => setSettings((current) => ({ ...current, icon }))}
          />
          <p id={`${ids.icon}-hint`} className={styles.hint}>
            Shown in the side menu, on the library's page and on Libraries. Until one is picked, the
            library wears its type's.
          </p>
        </fieldset>

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
          <div className={styles.setting}>
            <input
              id={`${ids.settings}-refresh`}
              type="checkbox"
              className={styles.checkbox}
              checked={settings.autoRefresh}
              onChange={(event) =>
                setSettings((current) => ({ ...current, autoRefresh: event.target.checked }))
              }
              aria-describedby={`${ids.settings}-refresh-hint`}
            />
            <label htmlFor={`${ids.settings}-refresh`}>Refresh automatically</label>
            <p id={`${ids.settings}-refresh-hint`} className={styles.settingHint}>
              Watch the folders and take in videos as they are added, removed, renamed or replaced.
              A share that does not report its changes still needs a rescan.
            </p>
          </div>
          <div className={styles.setting}>
            <input
              id={`${ids.settings}-locked`}
              type="checkbox"
              className={styles.checkbox}
              checked={settings.locked}
              disabled={!lockable && !settings.locked}
              onChange={(event) =>
                setSettings((current) => ({ ...current, locked: event.target.checked }))
              }
              aria-describedby={`${ids.settings}-locked-hint`}
            />
            <label htmlFor={`${ids.settings}-locked`}>Lock with the PIN</label>
            <p id={`${ids.settings}-locked-hint`} className={styles.settingHint}>
              {lockable &&
                'Keep its videos private: they stay hidden until the PIN is entered in this browser.'}
              {!lockable && (
                <>
                  Set <code>LIBRARY_PIN</code> in raven's <code>.env</code> to lock a library.
                </>
              )}
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
          {matchTypeFor(settings.kind) != null && (
            <div className={styles.setting}>
              <input
                id={`${ids.settings}-layout`}
                type="checkbox"
                className={styles.checkbox}
                checked={settings.folderLayout === 'auto'}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    folderLayout: event.target.checked ? 'auto' : 'flat',
                  }))
                }
                aria-describedby={`${ids.settings}-layout-hint`}
              />
              <label htmlFor={`${ids.settings}-layout`}>Read letter and group folders</label>
              <div className={styles.layoutHint}>
                <p id={`${ids.settings}-layout-hint`}>
                  Shows and movies inside letter folders (A, B, #) and group folders such as
                  Requests are read as titles of their own. Turn this off when those folder names
                  are the titles.
                </p>
                {!!library && library.layouts.length > 0 && (
                  <ul className={styles.layouts}>
                    {library.layouts.map((entry) => (
                      <li key={entry.path}>{`${entry.path}: ${pathLayoutLabel(entry)}`}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {matchTypeFor(settings.kind) != null && (
            <div className={styles.watched}>
              <label htmlFor={`${ids.settings}-ratings`}>Ratings shown</label>
              <select
                id={`${ids.settings}-ratings`}
                className={styles.input}
                value={settings.ratingsSource}
                onChange={(event) => {
                  const ratingsSource = event.target.value
                  if (isRatingSource(ratingsSource)) {
                    setSettings((current) => ({ ...current, ratingsSource }))
                  }
                }}
                aria-describedby={`${ids.settings}-ratings-hint`}
              >
                {RATING_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {RATINGS_LABELS[source]}
                  </option>
                ))}
              </select>
              <p id={`${ids.settings}-ratings-hint`} className={styles.settingHint}>
                The score on cards, and the one the rating sorts use. Where that source has none,
                TMDB's stands in. IMDb, Rotten Tomatoes and Metacritic need{' '}
                <code>OMDB_API_KEY</code>.
              </p>
            </div>
          )}
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
