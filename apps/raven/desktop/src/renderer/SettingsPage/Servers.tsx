import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button, KEYS } from '@raven/ui'
import { useDownloads } from '@/renderer/desktop/downloadsApi'
import { SERVERS_KEY, useServers } from '@/renderer/desktop/serverApi'
import styles from '@/renderer/SettingsPage/Servers.module.scss'
import { RECENTS_KEY } from '@/renderer/Shell/openReply'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopRequest,
  type ServerView,
} from '@/shared/protocol'

const UNCHANGED = 'raven player could not change its servers. Try again.'
const ALREADY_ADDED = 'That server is already in raven player.'

type ServerChange = Extract<
  DesktopRequest,
  {
    type:
      | typeof DESKTOP_REQUESTS.addServer
      | typeof DESKTOP_REQUESTS.renameServer
      | typeof DESKTOP_REQUESTS.removeServer
  }
>

const ANSWER_KINDS = { servers: 'servers', declined: 'declined', refused: 'refused' } as const

/** Main's answer to a change: the servers it now keeps, a declined prompt, or a refusal already shown. */
type Answer =
  | { kind: typeof ANSWER_KINDS.servers; servers: ServerView[] }
  | { kind: typeof ANSWER_KINDS.declined }
  | { kind: typeof ANSWER_KINDS.refused }

const ROW_MODES = { view: 'view', rename: 'rename', remove: 'remove' } as const

/** What a row shows: the server, its rename form, or the question before a removal. */
type RowMode = (typeof ROW_MODES)[keyof typeof ROW_MODES]

/** One row at a time is renaming or confirming; opening another puts the first back. */
type Active = { serverId: string; mode: Exclude<RowMode, typeof ROW_MODES.view> }

const ABOUT_KINDS = { add: 'add', rename: 'rename', remove: 'remove' } as const

/** What the section's alert speaks of: the add form, or one row's rename or removal. */
type About =
  | { kind: typeof ABOUT_KINDS.add }
  | { kind: typeof ABOUT_KINDS.rename | typeof ABOUT_KINDS.remove; serverId: string }

type Refusal = { message: string; about: About }

const focus = (element: HTMLElement | null) => {
  if (element !== null) element.focus()
}

/** Removing a server deletes its downloads too, so the question says so when it has any. */
const removalQuestion = ({ name, downloads }: { name: string; downloads: number }): string => {
  const signsOut = `Remove ${name}? This signs raven player out of it`
  if (downloads === 0) return `${signsOut}.`
  return `${signsOut} and deletes its ${downloads} ${downloads === 1 ? 'download' : 'downloads'}.`
}

const ServerRow = ({
  server,
  downloads,
  mode,
  renameRefusalId,
  removeRefusalId,
  onMode,
  onRename,
  onRemove,
}: {
  server: ServerView
  /** How many downloads raven player keeps from this server. */
  downloads: number
  mode: RowMode
  /** The section's alert, while it speaks of this row's rename. */
  renameRefusalId: string | null
  /** The section's alert, while it speaks of this row's removal. */
  removeRefusalId: string | null
  onMode: (mode: RowMode) => void
  /** Resolves true once main has the new name, so the form can close. */
  onRename: (change: { server: ServerView; name: string }) => Promise<boolean>
  onRemove: (change: { server: ServerView }) => void
}) => {
  const [name, setName] = useState(server.name)
  const row = useRef<HTMLLIElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const removeButton = useRef<HTMLButtonElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const previousMode = useRef<RowMode>(mode)
  const questionId = useId()

  // Focus follows the swap: into the form or the question, then back to the button that opened it,
  // unless the person has moved on to another row.
  useEffect(() => {
    const previous = previousMode.current
    previousMode.current = mode
    if (mode === ROW_MODES.rename) return focus(field.current)
    if (mode === ROW_MODES.remove) return focus(keepButton.current)
    if (previous === ROW_MODES.view) return
    const active = document.activeElement
    const isFocusLost = active === null || active === document.body
    if (!isFocusLost && !(row.current?.contains(active) ?? false)) return
    focus(previous === ROW_MODES.rename ? renameButton.current : removeButton.current)
  }, [mode])

  const openRename = () => {
    setName(server.name)
    onMode(ROW_MODES.rename)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (await onRename({ server, name })) return
    // Refused: back to the name, so the person can correct it.
    focus(field.current)
  }

  const backOnEscape = (event: KeyboardEvent) => {
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    onMode(ROW_MODES.view)
  }

  const content = () => {
    switch (mode) {
      case ROW_MODES.rename:
        return (
          <form className={styles.rename} onSubmit={(event) => void save(event)}>
            <label className={styles.renameField}>
              Name for {server.origin}
              <input
                ref={field}
                className={styles.input}
                value={name}
                maxLength={80}
                autoComplete="off"
                aria-invalid={renameRefusalId !== null}
                aria-describedby={renameRefusalId ?? undefined}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={backOnEscape}
              />
            </label>
            <div className={styles.renameActions}>
              <Button type="submit" tone="primary" onKeyDown={backOnEscape}>
                Save
              </Button>
              <Button onClick={() => onMode(ROW_MODES.view)} onKeyDown={backOnEscape}>
                Cancel
              </Button>
            </div>
          </form>
        )
      case ROW_MODES.remove:
        return (
          <div className={styles.confirm}>
            <p id={questionId} className={styles.question}>
              {removalQuestion({ name: server.name, downloads })}
            </p>
            <div className={styles.confirmActions}>
              <Button
                tone="danger"
                aria-describedby={[questionId, removeRefusalId ?? ''].join(' ').trim()}
                onClick={() => onRemove({ server })}
                onKeyDown={backOnEscape}
              >
                Remove
              </Button>
              <Button
                ref={keepButton}
                onClick={() => onMode(ROW_MODES.view)}
                onKeyDown={backOnEscape}
              >
                Keep
              </Button>
            </div>
          </div>
        )
      case ROW_MODES.view:
        return (
          <>
            <span className={styles.name}>{server.name}</span>
            <code className={styles.origin}>{server.origin}</code>
            <div className={styles.actions}>
              <Button ref={renameButton} aria-label={`Rename ${server.name}`} onClick={openRename}>
                Rename
              </Button>
              <Button
                ref={removeButton}
                tone="danger"
                aria-label={`Remove ${server.name}`}
                aria-describedby={removeRefusalId ?? undefined}
                onClick={() => onMode(ROW_MODES.remove)}
              >
                Remove
              </Button>
            </div>
          </>
        )
      default: {
        const unreachable: never = mode
        return unreachable
      }
    }
  }

  return (
    <li ref={row} className={mode === ROW_MODES.view ? styles.server : styles.open}>
      {content()}
    </li>
  )
}

/** The raven servers raven player keeps: add one (main asks first), rename one, remove one. */
export const Servers = ({ className }: { className?: string }) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const servers = useServers()
  const downloads = useDownloads()
  const heading = useRef<HTMLHeadingElement>(null)
  const addressField = useRef<HTMLInputElement>(null)
  const isAddingNow = useRef(false)
  const refusalId = useId()
  const [status, setStatus] = useState('')
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [address, setAddress] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const send = async ({
    change,
    about,
  }: {
    change: ServerChange
    about: About
  }): Promise<Answer> => {
    // Emptied first: a live region announces a change, so the same text twice needs a gap.
    setStatus('')
    setRefusal(null)
    const refuse = (message: string): Answer => {
      setRefusal({ message, about })
      return { kind: ANSWER_KINDS.refused }
    }
    const reply = await client.request(change).catch(() => null)
    if (reply === null) return refuse(UNCHANGED)
    switch (reply.type) {
      case DESKTOP_REPLIES.servers:
        queryClient.setQueryData(SERVERS_KEY, reply.servers)
        // A removed server takes its recents with it, so Home reads them again.
        await queryClient.invalidateQueries({ queryKey: RECENTS_KEY })
        return { kind: ANSWER_KINDS.servers, servers: reply.servers }
      // The person said no to main's prompt, so there is nothing to say.
      case DESKTOP_REPLIES.done:
        return { kind: ANSWER_KINDS.declined }
      case DESKTOP_REPLIES.refused:
        return refuse(reply.message)
      case DESKTOP_REPLIES.play:
      case DESKTOP_REPLIES.playServer:
      case DESKTOP_REPLIES.file:
      case DESKTOP_REPLIES.recents:
      case DESKTOP_REPLIES.output:
      case DESKTOP_REPLIES.serverReply:
      case DESKTOP_REPLIES.serverUnreachable:
      case DESKTOP_REPLIES.updates:
      case DESKTOP_REPLIES.downloadAsk:
      case DESKTOP_REPLIES.downloads:
      case DESKTOP_REPLIES.space:
        return refuse(UNCHANGED)
      default: {
        const unreachable: never = reply
        return unreachable
      }
    }
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const origin = address.trim()
    if (origin === '' || isAddingNow.current) return
    isAddingNow.current = true
    setIsAdding(true)
    const before = new Set((servers.data ?? []).map((server) => server.serverId))
    const answer = await send({
      change: { type: DESKTOP_REQUESTS.addServer, origin },
      about: { kind: ABOUT_KINDS.add },
    })
    isAddingNow.current = false
    setIsAdding(false)
    if (answer.kind === ANSWER_KINDS.refused) return focus(addressField.current)
    if (answer.kind !== ANSWER_KINDS.servers) return
    setAddress('')
    // Main answers a known origin with the list as it was.
    const isNew = answer.servers.some((server) => !before.has(server.serverId))
    setStatus(isNew ? 'Server added.' : ALREADY_ADDED)
  }

  const rename = async ({ server, name }: { server: ServerView; name: string }) => {
    const answer = await send({
      change: { type: DESKTOP_REQUESTS.renameServer, serverId: server.serverId, name },
      about: { kind: ABOUT_KINDS.rename, serverId: server.serverId },
    })
    if (answer.kind !== ANSWER_KINDS.servers) return false
    setActive(null)
    // Main cleans the name, so the status says the one it kept.
    const kept =
      answer.servers.find((candidate) => candidate.serverId === server.serverId)?.name ??
      name.trim()
    setStatus(`Renamed to ${kept}.`)
    return true
  }

  const remove = async ({ server }: { server: ServerView }) => {
    const answer = await send({
      change: { type: DESKTOP_REQUESTS.removeServer, serverId: server.serverId },
      about: { kind: ABOUT_KINDS.remove, serverId: server.serverId },
    })
    if (answer.kind !== ANSWER_KINDS.servers) return
    // Main keeps a server whose removal it could not save, and answers with it still listed.
    if (answer.servers.some((candidate) => candidate.serverId === server.serverId)) {
      setActive(null)
      setRefusal({
        message: `raven player could not remove ${server.name}. Try again.`,
        about: { kind: ABOUT_KINDS.remove, serverId: server.serverId },
      })
      return
    }
    setActive(null)
    setStatus(`Removed ${server.name}. raven player signed out of it.`)
    // The row and its buttons are gone; the section's heading keeps the place.
    focus(heading.current)
  }

  const modeOf = (serverId: string): RowMode =>
    active !== null && active.serverId === serverId ? active.mode : ROW_MODES.view

  const changeMode = ({ serverId, mode }: { serverId: string; mode: RowMode }) => {
    // An editor opening or closing starts afresh, so no field is invalid from an old answer.
    setRefusal(null)
    setActive(mode === ROW_MODES.view ? null : { serverId, mode })
  }

  /** The alert's id for a row, while it speaks of that row's `kind` of change. */
  const refusalIdFor = ({
    serverId,
    kind,
  }: {
    serverId: string
    kind: typeof ABOUT_KINDS.rename | typeof ABOUT_KINDS.remove
  }): string | null => {
    if (refusal === null || refusal.about.kind !== kind) return null
    return refusal.about.serverId === serverId ? refusalId : null
  }

  const list = servers.data ?? null
  const downloadsOf = (serverId: string): number =>
    (downloads.data?.downloads ?? []).filter((view) => view.serverId === serverId).length
  const isAddRefused = refusal !== null && refusal.about.kind === ABOUT_KINDS.add

  return (
    <section className={`${styles.servers} ${className ?? ''}`} aria-labelledby="servers-title">
      <h2 id="servers-title" tabIndex={-1} ref={heading}>
        Servers
      </h2>
      <p>raven player plays titles from these raven servers. It signs in to each one separately.</p>
      {servers.isError && <p>{servers.error.message}</p>}
      {list !== null && list.length === 0 && (
        <p>
          No servers yet. Open a title with Open in raven player on raven web, or add a server here.
        </p>
      )}
      {list !== null && list.length > 0 && (
        <ul className={styles.list}>
          {list.map((server) => {
            const mode = modeOf(server.serverId)
            return (
              <ServerRow
                key={server.serverId}
                server={server}
                downloads={downloadsOf(server.serverId)}
                mode={mode}
                renameRefusalId={
                  mode === ROW_MODES.rename
                    ? refusalIdFor({ serverId: server.serverId, kind: ABOUT_KINDS.rename })
                    : null
                }
                removeRefusalId={refusalIdFor({
                  serverId: server.serverId,
                  kind: ABOUT_KINDS.remove,
                })}
                onMode={(next) => changeMode({ serverId: server.serverId, mode: next })}
                onRename={rename}
                onRemove={(change) => void remove(change)}
              />
            )
          })}
        </ul>
      )}
      <form className={styles.add} onSubmit={(event) => void add(event)}>
        <label className={styles.addField}>
          Server address
          <input
            ref={addressField}
            className={styles.input}
            type="url"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="https://raven.example.ts.net"
            value={address}
            aria-invalid={isAddRefused}
            aria-describedby={isAddRefused ? refusalId : undefined}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
        <Button className={styles.addButton} type="submit" tone="primary" aria-disabled={isAdding}>
          Add server
        </Button>
      </form>
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output>{status}</output>
      {refusal !== null && (
        <p id={refusalId} className={styles.refusal} role="alert" data-refused="true">
          {refusal.message}
        </p>
      )}
    </section>
  )
}
