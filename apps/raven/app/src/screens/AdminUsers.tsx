import {
  type Account,
  ApiError,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
  type MemberStatusChange,
} from '@raven/core'
import {
  memberStatusEdits,
  mutationKeys,
  queryKeys,
  useOptimisticMutation,
} from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentType, useState } from 'react'

import { SettingsButton, SettingsChoice, SettingsLine, SettingsSection } from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import { ADMIN_COPY, MEMBER_STATUS_LABELS, NOBODY_LABELS } from '@/screens/adminCopy'

type MemberStatus = Account['status']

const STATUSES: readonly MemberStatus[] = Object.values(MEMBER_STATUSES)

const ACTION_KEYS = { approve: 'approve', remove: 'remove' } as const
type ActionKey = (typeof ACTION_KEYS)[keyof typeof ACTION_KEYS]

/** What each action says, the status it leaves the account in and how a screen reader names it. */
const ACTIONS = {
  [ACTION_KEYS.approve]: {
    label: ADMIN_COPY.approve,
    status: MEMBER_STATUSES.approved,
    nameFor: ADMIN_COPY.approveFor,
  },
  [ACTION_KEYS.remove]: {
    label: ADMIN_COPY.remove,
    status: MEMBER_STATUSES.revoked,
    nameFor: ADMIN_COPY.removeFor,
  },
} as const satisfies Record<
  ActionKey,
  { label: string; status: MemberStatusChange['status']; nameFor: (email: string) => string }
>

const ROW_ACTIONS = {
  [MEMBER_STATUSES.pending]: [ACTION_KEYS.approve, ACTION_KEYS.remove],
  [MEMBER_STATUSES.approved]: [ACTION_KEYS.remove],
  [MEMBER_STATUSES.revoked]: [ACTION_KEYS.approve],
} as const satisfies Record<MemberStatus, readonly ActionKey[]>

type MemberActionsProps = {
  member: Account
  onAct: (action: ActionKey) => void
  onAsk: () => void
  onCancel: () => void
}

const OwnerActions = () => <SettingsLine text={ADMIN_COPY.owner} />

const AskingActions = ({ member, onAct, onCancel }: MemberActionsProps) => (
  <>
    <SettingsLine text={ADMIN_COPY.confirmRemove} />
    <SettingsButton
      isDisabled={false}
      name={ADMIN_COPY.yesRemoveFor(member.email)}
      onPress={() => onAct(ACTION_KEYS.remove)}
      text={ADMIN_COPY.yesRemove}
    />
    <SettingsButton
      isDisabled={false}
      name={ADMIN_COPY.cancelRemovingFor(member.email)}
      onPress={onCancel}
      text={ADMIN_COPY.cancel}
    />
  </>
)

const StatusActions = ({ member, onAct, onAsk }: MemberActionsProps) =>
  ROW_ACTIONS[member.status].map((action) => (
    <SettingsButton
      key={action}
      isDisabled={false}
      name={ACTIONS[action].nameFor(member.email)}
      onPress={() => (action === ACTION_KEYS.remove ? onAsk() : onAct(action))}
      text={ACTIONS[action].label}
    />
  ))

const ROW_STATES = { owner: 'owner', asking: 'asking', actions: 'actions' } as const
type RowState = (typeof ROW_STATES)[keyof typeof ROW_STATES]

const MEMBER_ACTIONS = {
  [ROW_STATES.owner]: OwnerActions,
  [ROW_STATES.asking]: AskingActions,
  [ROW_STATES.actions]: StatusActions,
} as const satisfies Record<RowState, ComponentType<MemberActionsProps>>

type RowStateOfProps = { member: Account; isAsking: boolean }

const rowStateOf = ({ member, isAsking }: RowStateOfProps): RowState => {
  if (member.isOwner) return ROW_STATES.owner
  if (isAsking) return ROW_STATES.asking
  return ROW_STATES.actions
}

type AdminUsersProps = { session: AppQueries; ownerId: string }

/**
 * Admin's Users, as the web's: the accounts by access, picked as the web's tabs are, each with
 * what can be done to it. Removing asks first, in the row. A refusal as not the owner takes the
 * section away, since the server's say-so wins over the account's own flag.
 */
export const AdminUsers = ({ session: { api, queries }, ownerId }: AdminUsersProps) => {
  const queryClient = useQueryClient()
  const members = useQuery(queries.membersQuery(ownerId))
  const setStatus = useOptimisticMutation({
    mutationKey: mutationKeys.members,
    mutationFn: (request: Parameters<typeof api.setMemberStatus>[0]) =>
      api.setMemberStatus(request),
    edits: ({ id, change }) => memberStatusEdits({ userId: ownerId, id, change }),
    settle: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(ownerId) }),
  })
  const [tab, setTab] = useState<MemberStatus>(MEMBER_STATUSES.pending)
  const [asking, setAsking] = useState<string | null>(null)
  const isRefused =
    members.error instanceof ApiError &&
    (members.error.refusal?.reason ?? null) === AUTH_REFUSALS.notOwner
  const withStatus = (status: MemberStatus) =>
    members.data?.filter((member) => member.status === status) ?? []
  const shown = withStatus(tab)
  const options = STATUSES.map((status) => ({
    key: status,
    label: ADMIN_COPY.tabLabel({
      status: MEMBER_STATUS_LABELS[status],
      count: withStatus(status).length,
    }),
  }))

  type ActProps = { member: Account; action: ActionKey }

  const act = ({ member, action }: ActProps) => {
    setAsking(null)
    setStatus.mutate({ id: member.id, change: { status: ACTIONS[action].status } })
  }

  return (
    !isRefused && (
      <SettingsSection note={ADMIN_COPY.usersHint} title={ADMIN_COPY.users}>
        {members.isPending && <SettingsLine text={ADMIN_COPY.reading} />}
        {members.error !== null && <SettingsLine isAlert text={members.error.message} />}
        {setStatus.failure !== null && (
          <SettingsLine isAlert text={`${ADMIN_COPY.changeFailed}${setStatus.failure.message}`} />
        )}
        {members.data !== undefined && (
          <SettingsChoice
            label={ADMIN_COPY.accounts}
            onChoose={setTab}
            options={options}
            value={tab}
          />
        )}
        {members.data !== undefined && shown.length === 0 && (
          <SettingsLine text={NOBODY_LABELS[tab]} />
        )}
        {shown.map((member) => {
          const Actions = MEMBER_ACTIONS[rowStateOf({ member, isAsking: asking === member.id })]
          return (
            <SettingsSection key={member.id} note={null} title={member.email}>
              <Actions
                member={member}
                onAct={(action) => act({ member, action })}
                onAsk={() => setAsking(member.id)}
                onCancel={() => setAsking(null)}
              />
            </SettingsSection>
          )
        })}
      </SettingsSection>
    )
  )
}
