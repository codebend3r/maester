import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ITEM_TYPES,
  type ItemDetails,
  type ItemMetadata,
  type ItemMetadataChange,
  type MatchItemType,
  type MediaItem,
} from '@raven/core'
import { type FormEvent, useId, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { MovieFiles } from '@/components/MovieFiles/MovieFiles'
import { api } from '@/lib/api'
import { afterItemEdited } from '@/lib/invalidate'
import { itemMetadataQuery } from '@/lib/queries'
import styles from '@/components/MetadataEditor/MetadataEditor.module.scss'

type Field = keyof ItemMetadata

/** Each field the form edits, by its key in `ItemMetadata`. */
const FIELD_KEYS = {
  title: 'title',
  year: 'year',
  contentRating: 'contentRating',
  tagline: 'tagline',
  summary: 'summary',
} as const satisfies { [K in Field]: K }

/** The box a field is typed in: a line, a number, or several lines. */
const FIELD_KINDS = { text: 'text', number: 'number', long: 'long' } as const

const FIELDS: readonly {
  key: Field
  label: string
  kind: (typeof FIELD_KINDS)[keyof typeof FIELD_KINDS]
}[] = [
  { key: FIELD_KEYS.title, label: 'Title', kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.year, label: 'Year', kind: FIELD_KINDS.number },
  { key: FIELD_KEYS.contentRating, label: 'Content rating', kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.tagline, label: 'Tagline', kind: FIELD_KINDS.text },
  { key: FIELD_KEYS.summary, label: 'Summary', kind: FIELD_KINDS.long },
]

/** What the form holds: every field as text, so an empty box means "nothing". */
type Draft = Record<Field, string>

const toDraft = (metadata: ItemMetadata): Draft => ({
  title: metadata.title,
  year: metadata.year == null ? '' : String(metadata.year),
  contentRating: metadata.contentRating ?? '',
  tagline: metadata.tagline ?? '',
  summary: metadata.summary ?? '',
})

/** A draft value as the API takes it; a blank is null, as is a year that is not a number. */
const valueOf = ({ key, text }: { key: Field; text: string }): string | number | null => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (key !== FIELD_KEYS.year) return trimmed
  const year = Number.parseInt(trimmed, 10)
  return Number.isInteger(year) ? year : null
}

/** The edition a file name carries, for the wand: the first version that has one. */
const editionFrom = (versions: readonly ItemDetails['versions'][number][]): string | null =>
  versions.find((version) => version.edition != null)?.edition ?? null

/**
 * Edit metadata: a movie's files, which Split apart gives a card each when
 * several share one, then the title, year, rating, tagline and summary a
 * page shows, each beside what TMDB says. A field written over keeps TMDB's
 * words underneath, and "Use TMDB's" puts them back; a refresh never
 * touches an edit. The wand puts the file name's edition in brackets after
 * the title. Cancel sits at the top, as Done does in Edit images, and Save
 * at the end of the form.
 */
export const MetadataEditor = ({
  details,
  everyCard = details.versions,
  itemKind,
  onDone,
}: {
  /** The item, its `versions` the files on the card the page is for. */
  details: ItemDetails
  /** A movie's files in the page's library, on every card. */
  everyCard?: readonly MediaItem[]
  itemKind: MatchItemType
  onDone: () => void
}) => {
  const ids = { heading: useId(), form: useId() }
  const queryClient = useQueryClient()
  const state = useQuery(itemMetadataQuery(details.id))
  // What the viewer has typed; until then, what the page shows.
  const [edited, setDraft] = useState<Draft | null>(null)
  const draft = edited ?? (state.data ? toDraft(state.data.shown) : null)

  const save = useMutation({
    mutationFn: (change: ItemMetadataChange) => api.setItemMetadata({ id: details.id, change }),
    onSuccess: async (updated) => {
      await afterItemEdited({ queryClient, updated, part: 'metadata' })
      onDone()
    },
  })

  const edition = itemKind === ITEM_TYPES.movie ? editionFrom(details.versions) : null
  const [first, ...rest] = details.versions
  const original = state.data?.original

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // A blank title would be refused; keep the one shown.
    if (!draft || !original || draft.title.trim() === '') return
    // A field back at TMDB's words is cleared rather than written over with
    // the same. One emptied where TMDB has words goes as '' (0 for the year),
    // which shows nothing, as null would bring TMDB's back.
    const change = FIELDS.reduce<ItemMetadataChange>((sent, field) => {
      const value = valueOf({ key: field.key, text: draft[field.key] })
      const empty = field.key === FIELD_KEYS.year ? 0 : ''
      return { ...sent, [field.key]: value === original[field.key] ? null : (value ?? empty) }
    }, {})
    save.mutate(change)
  }

  return (
    <section className={styles.editor} aria-labelledby={ids.heading}>
      <header className={styles.header}>
        <h2 id={ids.heading} className={styles.heading}>
          Edit metadata
        </h2>
        <Button icon="close" onClick={onDone}>
          Cancel
        </Button>
      </header>
      {itemKind === ITEM_TYPES.movie && first && (
        <MovieFiles files={[first, ...rest]} everyCard={everyCard} itemId={details.id} />
      )}
      <p className={styles.hint}>
        What is written here shows instead of TMDB’s words, and an emptied box shows nothing; TMDB’s
        stay underneath and come back with Use TMDB’s. A refresh never touches an edit.
      </p>
      {state.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          {state.error.message}
        </p>
      )}
      {save.isError && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={16} />
          <span>Could not save: {save.error.message}</span>
        </p>
      )}
      {draft && original && (
        <form id={ids.form} className={styles.form} onSubmit={submit}>
          {FIELDS.map((field) => {
            const id = `${ids.form}-${field.key}`
            const originalText = toDraft(original)[field.key]
            const differs = draft[field.key].trim() !== originalText.trim()
            return (
              <div key={field.key} className={styles.field}>
                <label htmlFor={id}>{field.label}</label>
                <div
                  className={
                    field.key === FIELD_KEYS.title && edition ? styles.withWand : styles.control
                  }
                >
                  {field.kind === FIELD_KINDS.long ? (
                    <textarea
                      id={id}
                      rows={4}
                      value={draft[field.key]}
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                  ) : (
                    <input
                      id={id}
                      type={field.kind === FIELD_KINDS.number ? 'number' : 'text'}
                      inputMode={field.kind === FIELD_KINDS.number ? 'numeric' : undefined}
                      value={draft[field.key]}
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                  )}
                  {field.key === FIELD_KEYS.title && edition && (
                    <Button
                      icon="wand"
                      aria-label={`Add the edition from the file name: ${edition}`}
                      title={`Title it “${original.title} (${edition})”, as the file name says`}
                      onClick={() =>
                        setDraft({ ...draft, title: `${original.title} (${edition})` })
                      }
                    />
                  )}
                </div>
                <p className={styles.original}>
                  <span>TMDB: {originalText === '' ? 'nothing' : originalText}</span>
                  {differs && (
                    <button
                      type="button"
                      className={styles.reset}
                      onClick={() => setDraft({ ...draft, [field.key]: originalText })}
                    >
                      Use TMDB’s
                    </button>
                  )}
                </p>
              </div>
            )
          })}
          <div className={styles.actions}>
            <Button tone="primary" type="submit" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
      {state.isPending && !state.isError && <p className={styles.hint}>Reading what TMDB says</p>}
    </section>
  )
}
