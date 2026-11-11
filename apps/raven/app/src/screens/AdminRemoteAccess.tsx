import {
  REMOTE_ACCESS_STATES,
  type RemoteAccessState,
  type RemoteAccessStatus,
  addressLineOf,
  checkedTimeOf,
  remoteAccessHopsOf,
  remoteLimitLabelOf,
} from '@raven/core'
import { useServerRemoteAccess } from '@raven/ui/headless'

import { SettingsFact, SettingsLine, SettingsSection } from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import {
  ADMIN_COPY,
  REACHABILITY_PROBLEM_COPY,
  REMOTE_ACCESS_COPY,
  REMOTE_ACCESS_STATUS_COPY,
} from '@/screens/adminCopy'

type StatusLinesProps = { status: RemoteAccessStatus }

/** Whether raven is reachable from outside, and why not when it is not. */
const StatusLines = ({ status }: StatusLinesProps) => (
  <>
    <SettingsLine text={REMOTE_ACCESS_STATUS_COPY[status.state]} />
    {status.state === REMOTE_ACCESS_STATES.unreachable && (
      <SettingsLine text={REACHABILITY_PROBLEM_COPY[status.problem]} />
    )}
  </>
)

type FactsProps = { state: RemoteAccessState }

/** The private address, the public one and the remote limit, each as the server holds it. */
const Facts = ({ state }: FactsProps) => {
  const { privateHop, publicHop } = remoteAccessHopsOf(state)
  const checkedAt = checkedTimeOf(state.status)
  return (
    <>
      <SettingsFact
        isCode
        label={REMOTE_ACCESS_COPY.privateLabel}
        value={addressLineOf({ ...privateHop, copy: REMOTE_ACCESS_COPY })}
      />
      <SettingsFact
        isCode
        label={REMOTE_ACCESS_COPY.publicLabel}
        value={addressLineOf({ ...publicHop, copy: REMOTE_ACCESS_COPY })}
      />
      <SettingsFact
        label={REMOTE_ACCESS_COPY.remoteLimit}
        value={remoteLimitLabelOf({ limit: state.settings.remoteLimit, copy: REMOTE_ACCESS_COPY })}
      />
      {checkedAt !== null && <SettingsLine text={REMOTE_ACCESS_COPY.checkedAt(checkedAt)} />}
    </>
  )
}

type AdminRemoteAccessProps = { session: AppQueries }

/**
 * Admin's Remote Access, to read only: whether raven is reachable from outside the home
 * network, its private and public address and the remote limit. Turning it on or off and
 * changing it are the web's and the desktop's alone, so nothing here writes.
 */
export const AdminRemoteAccess = ({ session: { api } }: AdminRemoteAccessProps) => {
  const { state } = useServerRemoteAccess({ api })
  return (
    <SettingsSection note={REMOTE_ACCESS_COPY.help} title={REMOTE_ACCESS_COPY.heading}>
      {state.isPending && <SettingsLine text={ADMIN_COPY.reading} />}
      {state.error !== null && <SettingsLine isAlert text={state.error.message} />}
      {state.data !== undefined && (
        <>
          <StatusLines status={state.data.status} />
          <Facts state={state.data} />
        </>
      )}
    </SettingsSection>
  )
}
