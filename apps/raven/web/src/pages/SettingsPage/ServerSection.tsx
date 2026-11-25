import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHECK_OUTCOMES,
  DEFAULT_ACCOUNT_PREFERENCES,
  type ServerId,
  cleanName,
  serverNameFor,
} from '@raven/core'
import { BUTTON_TONES, Button, classNames } from '@raven/ui'
import { accountPreferencesQuery, afterServersChanged, useActiveServer } from '@raven/ui/headless'
import { type FormEvent, useId, useState } from 'react'
import { type AccountKeeping, useAccountKeeping } from '@/lib/accountData'
import { COMMON_COPY } from '@/lib/copy'
import {
  type AccountEntry,
  type AddProblem,
  SERVER_KINDS,
  type ServerEntry,
  checkNewServer,
  isActiveEntry,
  isReachableFromPage,
  useOpenServer,
  useServers,
} from '@/lib/servers'
import { Section } from '@/pages/SettingsPage/Section'
import { ToggleChoice } from '@/pages/SettingsPage/ToggleChoice'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import settings from '@/pages/SettingsPage/SettingsPage.module.scss'
import styles from '@/pages/SettingsPage/ServerSection.module.scss'

const COPY = SETTINGS_COPY.server

const PROBLEM_COPY = COPY.problems satisfies Record<AddProblem, string>

/** One of the account's own servers, where the viewer may change the list. */
type KeptServer = { server: AccountEntry; keeping: AccountKeeping }

/** A server the viewer may rename: one the account added, or the home one by its id. */
type RenamableServer = { server: ServerEntry; keeping: AccountKeeping; serverId: ServerId }

type RenameProps = RenamableServer & { name: string }

/**
 * Writes a server's new name where the account keeps it: the account's row for one it added,
 * the account's name for the home one, which has no row.
 */
const renameServer = ({ server, keeping, serverId, name }: RenameProps): Promise<unknown> => {
  if (server.kind === SERVER_KINDS.account) {
    return keeping.client.renameServer({ id: server.rowId, name })
  }
  return keeping.client.nameServer({ serverId, name })
}

type RenameFormProps = RenamableServer & { onDone: () => void }

/** A server's new name, tidied and checked as every client's names are (`cleanName`). */
const RenameForm = ({ server, keeping, serverId, onDone }: RenameFormProps) => {
  const id = useId()
  const [name, setName] = useState(server.name)
  const [isBadName, setBadName] = useState(false)
  const queryClient = useQueryClient()
  const rename = useMutation({
    mutationFn: (newName: string) => renameServer({ server, keeping, serverId, name: newName }),
    onSuccess: async () => {
      await afterServersChanged({ queryClient, userId: keeping.userId })
      onDone()
    },
  })
  const save = (event: FormEvent) => {
    event.preventDefault()
    const cleaned = cleanName(name)
    setBadName(cleaned === null)
    if (cleaned !== null) rename.mutate(cleaned)
  }
  return (
    <form className={styles.rename} onSubmit={save}>
      <label htmlFor={id} className="visually-hidden">
        {COPY.newName}
      </label>
      <input
        id={id}
        className={styles.input}
        value={name}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
      <span className={styles.actions}>
        <Button type="submit" tone={BUTTON_TONES.primary} disabled={rename.isPending}>
          {COPY.save}
        </Button>
        <Button onClick={onDone}>{COMMON_COPY.cancel}</Button>
      </span>
      {isBadName && (
        <p className={settings.error} role="alert">
          {COPY.badName}
        </p>
      )}
      {rename.isError && (
        <p className={settings.error} role="alert">
          {COPY.failed(rename.error.message)}
        </p>
      )}
    </form>
  )
}

type ServerRowProps = {
  server: ServerEntry
  /** Set where the viewer may change the list: signed in, with accounts on. */
  keeping: AccountKeeping | null
}

/**
 * One server: its name, its address, and what it is (home, in use, or out of this page's reach
 * at an http address), with Use for another one in reach, Rename for any the account can name
 * (the home one too, once its id is read) and Remove for one the account added. Removing the
 * one in use goes home first.
 */
const ServerRow = ({ server, keeping }: ServerRowProps) => {
  const [isRenaming, setRenaming] = useState(false)
  const queryClient = useQueryClient()
  const open = useOpenServer()
  const isActive = useActiveServer((state) => isActiveEntry({ server, active: state.active }))
  const canReach = isReachableFromPage({ origin: server.origin })
  const remove = useMutation({
    mutationFn: async ({ server: removed, keeping: { client } }: KeptServer) => {
      if (isActive) useActiveServer.getState().choose(null)
      await client.removeServer({ id: removed.rowId })
    },
    onSuccess: (_, { keeping: { userId } }) => afterServersChanged({ queryClient, userId }),
  })
  const kept: KeptServer | null =
    server.kind === SERVER_KINDS.account && keeping !== null ? { server, keeping } : null
  const renamable: RenamableServer | null =
    keeping !== null && server.serverId !== null
      ? { server, keeping, serverId: server.serverId }
      : null
  return (
    <li className={classNames([styles.server, isActive && styles.active])}>
      <span className={styles.facts}>
        <span className={styles.name}>{server.name}</span>
        <a className={styles.origin} href={server.origin}>
          {server.origin}
        </a>
        <span className={styles.tags}>
          {server.kind === SERVER_KINDS.home && <span className={styles.tag}>{COPY.home}</span>}
          {isActive && <span className={styles.tag}>{COPY.inUse}</span>}
        </span>
        {!canReach && <span className={settings.hint}>{COPY.needsHttps}</span>}
      </span>
      <span className={styles.actions}>
        {!isActive && canReach && (
          <Button aria-label={COPY.switchToName(server.name)} onClick={() => open(server)}>
            {COPY.use}
          </Button>
        )}
        {renamable !== null && !isRenaming && (
          <Button
            icon="edit"
            aria-label={COPY.renameName(server.name)}
            onClick={() => setRenaming(true)}
          >
            {COPY.rename}
          </Button>
        )}
        {kept !== null && !isRenaming && (
          <Button
            icon="trash"
            aria-label={COPY.removeName(server.name)}
            disabled={remove.isPending}
            onClick={() => remove.mutate(kept)}
          >
            {COPY.remove}
          </Button>
        )}
      </span>
      {renamable !== null && isRenaming && (
        <RenameForm {...renamable} onDone={() => setRenaming(false)} />
      )}
      {remove.isError && (
        <p className={settings.error} role="alert">
          {COPY.failed(remove.error.message)}
        </p>
      )}
    </li>
  )
}

type PinServersChoiceProps = { keeping: AccountKeeping }

/**
 * Whether each pinned library names its server while the account keeps several: the account's
 * choice, so it follows it to every app. The Libraries page names the server whatever it says.
 */
const PinServersChoice = ({ keeping }: PinServersChoiceProps) => {
  const queryClient = useQueryClient()
  const preferences = useQuery(accountPreferencesQuery(keeping))
  const change = useMutation({
    mutationFn: (showPinServers: boolean) => keeping.client.setPreferences({ showPinServers }),
    onSuccess: (written) =>
      queryClient.setQueryData(accountPreferencesQuery(keeping).queryKey, written),
  })
  const isKeptOn = preferences.data?.showPinServers ?? DEFAULT_ACCOUNT_PREFERENCES.showPinServers
  // While the change saves it shows at once; a refused change goes back to what is kept.
  const isChecked = change.isPending ? change.variables : isKeptOn
  return (
    <>
      <ToggleChoice
        label={COPY.showPinServers}
        hint={COPY.showPinServersHint}
        isChecked={isChecked}
        disabled={change.isPending || preferences.isPlaceholderData}
        onChange={(checked) => change.mutate(checked)}
      />
      {change.isError && (
        <p className={settings.error} role="alert">
          {COPY.failed(change.error.message)}
        </p>
      )}
    </>
  )
}

type AddServerProps = { servers: readonly ServerEntry[]; keeping: AccountKeeping }

/**
 * Adds a server by its address: read as every client reads one, checked against this page
 * (an http server from an https page is refused, as the browser would refuse it without a
 * word) and the list, then asked for its id on its open `/api/health`, which names it on the
 * account. It is named after its address, which Rename changes.
 */
const AddServer = ({ servers, keeping }: AddServerProps) => {
  const id = useId()
  const hintId = useId()
  const [address, setAddress] = useState('')
  const [problem, setProblem] = useState<AddProblem | null>(null)
  const queryClient = useQueryClient()
  const add = useMutation({
    mutationFn: async (typed: string) => {
      const check = await checkNewServer({ address: typed, servers })
      if (check.kind === CHECK_OUTCOMES.refused) return check.problem
      await keeping.client.addServer({
        serverId: check.serverId,
        name: serverNameFor(check.origin),
        origin: check.origin,
      })
      await afterServersChanged({ queryClient, userId: keeping.userId })
      return null
    },
    onSuccess: (refusal) => {
      setProblem(refusal)
      if (refusal === null) setAddress('')
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate(address)
  }
  return (
    <form className={styles.add} onSubmit={submit}>
      <label htmlFor={id} className={styles.label}>
        {COPY.address}
      </label>
      <span className={styles.addRow}>
        <input
          id={id}
          className={styles.input}
          value={address}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={hintId}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button
          type="submit"
          tone={BUTTON_TONES.primary}
          icon="plus"
          disabled={add.isPending || address.trim() === ''}
        >
          {add.isPending ? COPY.adding : COPY.add}
        </Button>
      </span>
      <span id={hintId} className={settings.hint}>
        {COPY.addressHint}
      </span>
      {problem !== null && (
        <p className={settings.error} role="alert">
          {PROBLEM_COPY[problem]}
        </p>
      )}
      {add.isError && (
        <p className={settings.error} role="alert">
          {COPY.failed(add.error.message)}
        </p>
      )}
    </form>
  )
}

/**
 * Where the media comes from: the home server (the one this page came from) first, then the
 * account's others, the one in use marked, each to switch to and to rename; the account's own
 * can be removed, a new one added by its address, and the pins' server names turned off. With accounts off, or no one signed in,
 * there is only the home server. In Raven, main reads a new server's health and switches its
 * own reach to the one in use (`desktop/servers.ts`).
 */
export const ServerSection = () => {
  const servers = useServers()
  const keeping = useAccountKeeping()
  return (
    <Section icon="globe" title={COPY.heading} help={COPY.help}>
      <ul className={styles.servers} aria-label={COPY.list}>
        {servers.map((server) => (
          <ServerRow key={server.key} server={server} keeping={keeping} />
        ))}
      </ul>
      {keeping !== null && <AddServer servers={servers} keeping={keeping} />}
      {keeping !== null && <PinServersChoice keeping={keeping} />}
      {keeping === null && <p className={settings.hint}>{COPY.signInToAdd}</p>}
    </Section>
  )
}
