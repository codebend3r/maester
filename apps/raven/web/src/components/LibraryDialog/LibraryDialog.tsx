import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_LIBRARY_SETTINGS,
  FOLDER_LAYOUTS,
  KINDS,
  type Library,
  type LibraryInput,
  type LibraryKind,
  type LibrarySettings,
  METADATA_SERVICE_STATES,
  PATH_LAYOUTS,
  type PathLayout,
  defaultLibrarySettings,
  isLibraryKind,
  isRatingSource,
  libraryIconOf,
  matchTypeFor,
  validateLibraryInput,
  withLibraryKind,
} from '@raven/core'
import { type ComponentType, type FormEvent, type ReactNode, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '@raven/ui'
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser'
import { IconPicker } from '@/components/LibraryDialog/IconPicker'
import { api } from '@/lib/api'
import { afterLibrarySaved } from '@raven/ui/headless'
import { lockQuery, metadataHealthQuery } from '@/lib/queries'
import { RATING_SOURCE_LABELS } from '@/lib/ratingSources'
import { useModal } from '@/lib/useModal'
import { LIBRARY_DIALOG_COPY } from '@/components/LibraryDialog/copy'
import styles from '@/components/LibraryDialog/LibraryDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type PathLayoutLabelProps = {
  layout: PathLayout | null
  groups: number
}

/** What Edit library calls each way a path was read. */
const pathLayoutLabel = ({ layout, groups }: PathLayoutLabelProps): string => {
  if (layout == null) return LIBRARY_DIALOG_COPY.notScanned
  if (layout === PATH_LAYOUTS.flat) return LIBRARY_DIALOG_COPY.oneFolderPerTitle
  return layout === PATH_LAYOUTS.lettered
    ? LIBRARY_DIALOG_COPY.letterFolders(groups)
    : LIBRARY_DIALOG_COPY.groupFolders(groups)
}

type EnvNoteProps = { name: string; children: string }

/** A line asking for a variable in raven's `.env`: Set NAME in raven's .env, then what it does. */
const EnvNote = ({ name, children }: EnvNoteProps) => (
  <>
    {LIBRARY_DIALOG_COPY.set} <code>{name}</code> {LIBRARY_DIALOG_COPY.inRavensEnv}{' '}
    <code>{COMMON_COPY.envFile}</code> {children}
  </>
)

/** Whether TMDB has a token, which decides what the Type hint says first. */
const SERVICE_STATES = {
  on: 'on',
  off: 'off',
} as const

type ServiceState = (typeof SERVICE_STATES)[keyof typeof SERVICE_STATES]

const TMDB_HINTS = {
  [SERVICE_STATES.off]: () => (
    <EnvNote name={LIBRARY_DIALOG_COPY.tmdbToken}>{LIBRARY_DIALOG_COPY.tmdbOff}</EnvNote>
  ),
  [SERVICE_STATES.on]: () => LIBRARY_DIALOG_COPY.tmdbOn,
} as const satisfies Record<ServiceState, ComponentType>

const LOCK_HINTS = {
  [SERVICE_STATES.on]: () => LIBRARY_DIALOG_COPY.lockHint,
  [SERVICE_STATES.off]: () => (
    <EnvNote name={LIBRARY_DIALOG_COPY.libraryPin}>{LIBRARY_DIALOG_COPY.lockOff}</EnvNote>
  ),
} as const satisfies Record<ServiceState, ComponentType>

/** Where a setting's hint sits: alone, or beside what follows it. */
const HINT_LAYOUTS = {
  alone: 'alone',
  withExtra: 'withExtra',
} as const

type HintLayout = (typeof HINT_LAYOUTS)[keyof typeof HINT_LAYOUTS]

type SettingHintProps = { id: string; hint: ReactNode; children?: ReactNode }

const SETTING_HINTS = {
  [HINT_LAYOUTS.alone]: ({ id, hint }: SettingHintProps) => (
    <p id={`${id}-hint`} className={styles.settingHint}>
      {hint}
    </p>
  ),
  [HINT_LAYOUTS.withExtra]: ({ id, hint, children }: SettingHintProps) => (
    <div className={styles.layoutHint}>
      <p id={`${id}-hint`}>{hint}</p>
      {children}
    </div>
  ),
} as const satisfies Record<HintLayout, ComponentType<SettingHintProps>>

type SettingToggleProps = {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  /** The line under the label, which the box is described by. */
  hint: ReactNode
  /** What follows the hint, kept apart from it: the layouts read so far. */
  children?: ReactNode
}

/** One of the library's switches: its box, its label beside it and its hint under them. */
const SettingToggle = ({
  id,
  label,
  checked,
  disabled = false,
  onChange,
  hint,
  children,
}: SettingToggleProps) => {
  const Hint = SETTING_HINTS[children === undefined ? HINT_LAYOUTS.alone : HINT_LAYOUTS.withExtra]
  return (
    <div className={styles.setting}>
      <input
        id={id}
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-hint`}
      />
      <label htmlFor={id}>{label}</label>
      <Hint id={id} hint={hint}>
        {children}
      </Hint>
    </div>
  )
}

type LibraryDialogProps = { library?: Library; onClose: () => void }

/**
 * Creates a library, or edits one when `library` is given: its name, type,
 * icon, folders and settings in hairline-ruled groups, and the actions in a
 * footer that stays in view as the form scrolls, Delete at its start and
 * Save at its end. A native modal <dialog> handles focus trapping and
 * Escape; closing hands focus back to whatever opened it.
 */
export const LibraryDialog = ({ library, onClose }: LibraryDialogProps) => {
  const { dialog } = useModal()
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
  const isAiOff = metadata.data?.ai === METADATA_SERVICE_STATES.off
  const lock = useQuery(lockQuery)
  const lockable = !!lock.data?.available
  const isMatched = matchTypeFor(settings.kind) != null
  const TmdbHint =
    TMDB_HINTS[
      metadata.data?.tmdb === METADATA_SERVICE_STATES.off ? SERVICE_STATES.off : SERVICE_STATES.on
    ]
  const LockHint = LOCK_HINTS[lockable ? SERVICE_STATES.on : SERVICE_STATES.off]

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

  // A new library takes the view, grouping and saved spots its type starts
  // with; one being edited keeps its own where the new type can show them.
  const pickKind = (kind: LibraryKind) =>
    setSettings((current) => {
      if (library) return withLibraryKind({ settings: current, kind })
      const { view, groupBy, saveProgress } = defaultLibrarySettings(kind)
      return { ...current, kind, view, groupBy, saveProgress }
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
          {library ? LIBRARY_DIALOG_COPY.editTitle : LIBRARY_DIALOG_COPY.addTitle}
        </h2>

        <div className={styles.body}>
          <div className={styles.field}>
            <label htmlFor={ids.name}>{COMMON_COPY.name}</label>
            <input
              id={ids.name}
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={LIBRARY_DIALOG_COPY.namePlaceholder}
              autoComplete="off"
              aria-describedby={errors.length > 0 ? ids.errors : undefined}
            />
          </div>

          <fieldset
            className={styles.group}
            aria-describedby={isAiOff ? `${ids.kind}-hint ${ids.kind}-ai-hint` : `${ids.kind}-hint`}
          >
            <legend>{LIBRARY_DIALOG_COPY.type}</legend>
            <div className={styles.kinds}>
              {isLibraryKind.values.map((kind) => (
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
              <TmdbHint /> {LIBRARY_DIALOG_COPY.audioKinds}
            </p>
            {isAiOff && (
              <p id={`${ids.kind}-ai-hint`} className={styles.hint}>
                <EnvNote name={LIBRARY_DIALOG_COPY.anthropicKey}>
                  {LIBRARY_DIALOG_COPY.aiOff}
                </EnvNote>
              </p>
            )}
          </fieldset>

          <fieldset className={styles.group} aria-describedby={`${ids.icon}-hint`}>
            <legend>{LIBRARY_DIALOG_COPY.icon}</legend>
            <IconPicker
              value={libraryIconOf(settings)}
              onChange={(icon) => setSettings((current) => ({ ...current, icon }))}
            />
            <p id={`${ids.icon}-hint`} className={styles.hint}>
              {LIBRARY_DIALOG_COPY.iconHint}
            </p>
          </fieldset>

          <fieldset className={styles.group} aria-describedby={ids.folders}>
            <legend>{LIBRARY_DIALOG_COPY.folders}</legend>
            <p id={ids.folders} className={styles.hint}>
              {LIBRARY_DIALOG_COPY.foldersHint}
            </p>
            {paths.length > 0 && (
              <ul className={styles.paths}>
                {paths.map((path) => (
                  <li key={path} className={styles.pathRow}>
                    <span className={styles.pathText}>{path}</span>
                    <Button
                      icon="close"
                      aria-label={LIBRARY_DIALOG_COPY.removePath(path)}
                      onClick={() => setPaths((current) => current.filter((item) => item !== path))}
                    />
                  </li>
                ))}
              </ul>
            )}
            <FolderBrowser onChoose={addPath} exclude={paths} />
            <div className={styles.typed}>
              <label htmlFor={`${ids.folders}-typed`} className="visually-hidden">
                {LIBRARY_DIALOG_COPY.folderPath}
              </label>
              <input
                id={`${ids.folders}-typed`}
                className={styles.input}
                value={typedPath}
                onChange={(event) => setTypedPath(event.target.value)}
                placeholder={LIBRARY_DIALOG_COPY.pathPlaceholder}
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
                {LIBRARY_DIALOG_COPY.add}
              </Button>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>{COMMON_COPY.settings}</legend>
            <SettingToggle
              id={`${ids.settings}-progress`}
              label={LIBRARY_DIALOG_COPY.saveProgress}
              checked={settings.saveProgress}
              onChange={(saveProgress) => setSettings((current) => ({ ...current, saveProgress }))}
              hint={LIBRARY_DIALOG_COPY.saveProgressHint}
            />
            <SettingToggle
              id={`${ids.settings}-pinned`}
              label={LIBRARY_DIALOG_COPY.pin}
              checked={settings.pinned}
              onChange={(pinned) => setSettings((current) => ({ ...current, pinned }))}
              hint={LIBRARY_DIALOG_COPY.pinHint}
            />
            <SettingToggle
              id={`${ids.settings}-refresh`}
              label={LIBRARY_DIALOG_COPY.autoRefresh}
              checked={settings.autoRefresh}
              onChange={(autoRefresh) => setSettings((current) => ({ ...current, autoRefresh }))}
              hint={LIBRARY_DIALOG_COPY.autoRefreshHint}
            />
            <SettingToggle
              id={`${ids.settings}-locked`}
              label={LIBRARY_DIALOG_COPY.lock}
              checked={settings.locked}
              disabled={!lockable && !settings.locked}
              onChange={(locked) => setSettings((current) => ({ ...current, locked }))}
              hint={<LockHint />}
            />
            <div className={styles.watched}>
              <label htmlFor={`${ids.settings}-watched`}>{LIBRARY_DIALOG_COPY.watchedAt}</label>
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
                <span aria-hidden="true">{LIBRARY_DIALOG_COPY.percent}</span>
              </span>
              <p id={`${ids.settings}-watched-hint`} className={styles.settingHint}>
                {LIBRARY_DIALOG_COPY.watchedHint}
              </p>
            </div>
            {isMatched && (
              <SettingToggle
                id={`${ids.settings}-layout`}
                label={LIBRARY_DIALOG_COPY.readLayouts}
                checked={settings.folderLayout === FOLDER_LAYOUTS.auto}
                onChange={(isAuto) =>
                  setSettings((current) => ({
                    ...current,
                    folderLayout: isAuto ? FOLDER_LAYOUTS.auto : FOLDER_LAYOUTS.flat,
                  }))
                }
                hint={LIBRARY_DIALOG_COPY.readLayoutsHint}
              >
                {!!library && library.layouts.length > 0 && (
                  <ul className={styles.layouts}>
                    {library.layouts.map((entry) => (
                      <li key={entry.path}>
                        {LIBRARY_DIALOG_COPY.pathLayout({
                          path: entry.path,
                          label: pathLayoutLabel(entry),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </SettingToggle>
            )}
            {isMatched && (
              <div className={styles.watched}>
                <label htmlFor={`${ids.settings}-ratings`}>
                  {LIBRARY_DIALOG_COPY.ratingsShown}
                </label>
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
                  {isRatingSource.values.map((source) => (
                    <option key={source} value={source}>
                      {RATING_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
                <p id={`${ids.settings}-ratings-hint`} className={styles.settingHint}>
                  {LIBRARY_DIALOG_COPY.ratingsHint} <code>{LIBRARY_DIALOG_COPY.mdblistKey}</code>{' '}
                  {LIBRARY_DIALOG_COPY.or} <code>{LIBRARY_DIALOG_COPY.omdbKey}</code>
                  {LIBRARY_DIALOG_COPY.ratingsHintEnd}
                </p>
              </div>
            )}
          </fieldset>

          {errors.length > 0 && (
            <ul id={ids.errors} className={styles.errors} role="alert">
              {errors.map((error) => (
                <li key={error} className={styles.error}>
                  <Icon name="alert" size={16} />
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>

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
              {confirmingDelete ? COMMON_COPY.deleteForGood : LIBRARY_DIALOG_COPY.deleteLibrary}
            </Button>
          )}
          <Button onClick={() => dialog.current?.close()}>{COMMON_COPY.cancel}</Button>
          <Button type="submit" tone="primary" disabled={save.isPending}>
            {library ? LIBRARY_DIALOG_COPY.saveChanges : COMMON_COPY.addLibrary}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
