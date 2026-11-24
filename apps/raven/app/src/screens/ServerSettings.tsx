import { type AddProblem, type AppServer, IGNORED, RENAME_OUTCOMES } from '@raven/native/headless'
import { afterPins } from '@raven/ui/headless'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useAccountSession } from '@/account/session'
import { Field, SettingsButton, SettingsFact, SettingsLine, SettingsSection } from '@/layouts'
import { useGoHome } from '@/layouts/useGoHome'
import { SERVERS_COPY } from '@/screens/copy'
import { accountServers, useActiveServer } from '@/stores/activeServer'

const PROBLEM_COPY = SERVERS_COPY.problems satisfies Record<AddProblem, string>

type RenameFormProps = { server: AppServer; onDone: () => void }

/** A server's new name, tidied and checked as every client's list renames (`renamedServers`). */
const RenameForm = ({ server, onDone }: RenameFormProps) => {
  const [name, setName] = useState(server.name)
  const [isBadName, setBadName] = useState(false)
  const rename = useMutation({
    mutationFn: (typed: string) => accountServers.rename({ id: server.id, name: typed }),
    onSuccess: (outcome) => {
      const isRenamed = outcome === RENAME_OUTCOMES.renamed
      setBadName(!isRenamed)
      if (isRenamed) onDone()
    },
  })
  return (
    <>
      <Field
        label={SERVERS_COPY.newName}
        onChangeText={setName}
        onSubmit={({ text }) => rename.mutate(text)}
        value={name}
      />
      <SettingsButton
        isDisabled={rename.isPending}
        name={SERVERS_COPY.save}
        onPress={() => rename.mutate(name)}
        text={SERVERS_COPY.save}
      />
      <SettingsButton isDisabled={false} onPress={onDone} text={SERVERS_COPY.cancel} />
      {isBadName && <SettingsLine isAlert text={SERVERS_COPY.badName} />}
      {rename.isError && <SettingsLine isAlert text={SERVERS_COPY.failed(rename.error.message)} />}
    </>
  )
}

type ServerRowProps = {
  server: AppServer
  /** Whether the account may change the list: someone is signed in. */
  canChange: boolean
}

/**
 * One server: its name and address, what it is (home, in use), Use for another one, and for
 * one the account added, Rename and Remove. Using another opens its Home, since the screens
 * below were the last server's; removing the one in use goes home first.
 */
const ServerRow = ({ server, canChange }: ServerRowProps) => {
  const [isRenaming, setRenaming] = useState(false)
  const queryClient = useQueryClient()
  const goHome = useGoHome()
  const homeId = useActiveServer((state) => state.home.id)
  const isActive = useActiveServer((state) => state.activeId === server.id)
  const activate = useActiveServer((state) => state.activate)
  const isHome = server.id === homeId
  const canKeep = canChange && !isHome
  const remove = useMutation({
    mutationFn: () => accountServers.remove(server.id),
    onSuccess: () => afterPins(queryClient),
  })
  const tags = [...(isHome ? [SERVERS_COPY.home] : []), ...(isActive ? [SERVERS_COPY.inUse] : [])]
  const use = () => {
    activate(server.id)
    goHome()
  }
  return (
    <>
      <SettingsFact isCode label={server.name} value={server.origin} />
      {tags.length > 0 && <SettingsLine text={SERVERS_COPY.tags(tags)} />}
      {!isActive && (
        <SettingsButton
          isDisabled={false}
          name={SERVERS_COPY.switchToName(server.name)}
          onPress={use}
          text={SERVERS_COPY.use}
        />
      )}
      {canKeep && !isRenaming && (
        <>
          <SettingsButton
            isDisabled={false}
            name={SERVERS_COPY.renameName(server.name)}
            onPress={() => setRenaming(true)}
            text={SERVERS_COPY.rename}
          />
          <SettingsButton
            isDisabled={remove.isPending}
            name={SERVERS_COPY.removeName(server.name)}
            onPress={() => remove.mutate()}
            text={SERVERS_COPY.remove}
          />
        </>
      )}
      {canKeep && isRenaming && <RenameForm onDone={() => setRenaming(false)} server={server} />}
      {remove.isError && <SettingsLine isAlert text={SERVERS_COPY.failed(remove.error.message)} />}
    </>
  )
}

/**
 * Adds a server by its address: read as every client reads one, checked against the list, then
 * asked for its id on its open `/api/health`, which names it on the account. It is named after
 * its address, which Rename changes.
 */
const AddServer = () => {
  const [address, setAddress] = useState('')
  const [problem, setProblem] = useState<AddProblem | null>(null)
  const add = useMutation({
    mutationFn: (typed: string) => accountServers.add(typed),
    onSuccess: (refusal) => {
      setProblem(refusal)
      if (refusal === null) setAddress('')
    },
  })
  return (
    <>
      <Field
        label={SERVERS_COPY.address}
        onChangeText={setAddress}
        onSubmit={({ text }) => add.mutate(text)}
        placeholder={SERVERS_COPY.addressHint}
        value={address}
      />
      <SettingsButton
        isDisabled={add.isPending || address.trim() === ''}
        onPress={() => add.mutate(address)}
        text={add.isPending ? SERVERS_COPY.adding : SERVERS_COPY.add}
      />
      {problem !== null && <SettingsLine isAlert text={PROBLEM_COPY[problem]} />}
      {add.isError && <SettingsLine isAlert text={SERVERS_COPY.failed(add.error.message)} />}
    </>
  )
}

/**
 * Where the media comes from: home (the server this app was built for) first, then the account's
 * others, the one in use marked, each to switch to; the account's own can be renamed and
 * removed, and a new one added by its address. The list is the account's, so a change here shows
 * on every device it signs in on, and it is read again as the section opens.
 */
export const ServerSettings = () => {
  const servers = useActiveServer((state) => state.servers)
  const isSignedIn = useAccountSession((state) => state.session !== null)
  useEffect(() => {
    accountServers.sync().catch(IGNORED)
  }, [])
  return (
    <SettingsSection note={SERVERS_COPY.help} title={SERVERS_COPY.heading}>
      {servers.map((server) => (
        <ServerRow key={server.id} canChange={isSignedIn} server={server} />
      ))}
      {isSignedIn && <AddServer />}
      {!isSignedIn && <SettingsLine text={SERVERS_COPY.signInToAdd} />}
    </SettingsSection>
  )
}
