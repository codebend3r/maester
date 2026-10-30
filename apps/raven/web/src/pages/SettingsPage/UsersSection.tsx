import { type ComponentType, type RefObject, useEffect, useId, useRef, useState } from 'react'
import {
  type Account,
  type MemberStatusChange,
  ApiError,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
} from '@raven/core'
import { Button, type ButtonTone } from '@raven/ui'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { Tabs } from '@/components/Tabs/Tabs'
import { useMembers } from '@/lib/useMembers'
import { useReturnFocus } from '@/lib/useReturnFocus'
import { type MemberStatus, STATUS_NAMES } from '@/pages/SettingsPage/memberStatus'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import usersStyles from '@/pages/SettingsPage/UsersSection.module.scss'
import { COMMON_COPY } from '@/lib/copy'

const TABS: readonly MemberStatus[] = Object.values(MEMBER_STATUSES)

const NOBODY = {
  [MEMBER_STATUSES.pending]: 'No one is waiting for approval.',
  [MEMBER_STATUSES.approved]: 'No one is approved yet.',
  [MEMBER_STATUSES.revoked]: 'No one has been removed.',
} as const satisfies Record<MemberStatus, string>

const ACTION_KEYS = { approve: 'approve', remove: 'remove' } as const
type ActionKey = (typeof ACTION_KEYS)[keyof typeof ACTION_KEYS]

/** What each action says and how it looks, which status it leaves the account in, and how a screen reader names it among many rows. */
const ACTIONS = {
  [ACTION_KEYS.approve]: {
    label: 'Approve',
    tone: 'primary',
    status: MEMBER_STATUSES.approved,
    nameFor: (email: string) => `Approve ${email}`,
  },
  [ACTION_KEYS.remove]: {
    label: 'Remove access',
    tone: 'quiet',
    status: MEMBER_STATUSES.revoked,
    nameFor: (email: string) => `Remove access for ${email}`,
  },
} as const satisfies Record<
  ActionKey,
  {
    label: string
    tone: ButtonTone
    status: MemberStatusChange['status']
    nameFor: (email: string) => string
  }
>

const ROW_ACTIONS = {
  [MEMBER_STATUSES.pending]: [ACTION_KEYS.approve, ACTION_KEYS.remove],
  [MEMBER_STATUSES.approved]: [ACTION_KEYS.remove],
  [MEMBER_STATUSES.revoked]: [ACTION_KEYS.approve],
} as const satisfies Record<MemberStatus, readonly ActionKey[]>

type MemberActionsProps = {
  member: Account
  isBusy: boolean
  removeButton: RefObject<HTMLButtonElement | null>
  cancelButton: RefObject<HTMLButtonElement | null>
  onAct: (action: ActionKey) => void
  onAsk: () => void
  onCancel: () => void
}

const OwnerActions = () => <span className={usersStyles.aside}>{SETTINGS_COPY.users.owner}</span>

type AskingActionsProps = MemberActionsProps

const AskingActions = ({ member, isBusy, cancelButton, onAct, onCancel }: AskingActionsProps) => (
  <>
    <p className={usersStyles.aside}>{SETTINGS_COPY.users.confirmRemove}</p>
    <Button
      tone="danger"
      disabled={isBusy}
      aria-label={SETTINGS_COPY.users.yesRemoveFor(member.email)}
      onClick={() => onAct(ACTION_KEYS.remove)}
    >
      {SETTINGS_COPY.users.yesRemove}
    </Button>
    <Button
      ref={cancelButton}
      aria-label={SETTINGS_COPY.users.cancelRemovingFor(member.email)}
      onClick={onCancel}
    >
      {COMMON_COPY.cancel}
    </Button>
  </>
)

type StatusActionsProps = MemberActionsProps

const StatusActions = ({ member, isBusy, removeButton, onAct, onAsk }: StatusActionsProps) =>
  ROW_ACTIONS[member.status].map((action) => {
    const isRemove = action === ACTION_KEYS.remove
    return (
      <Button
        key={action}
        ref={isRemove ? removeButton : undefined}
        tone={ACTIONS[action].tone}
        disabled={isBusy}
        aria-label={ACTIONS[action].nameFor(member.email)}
        onClick={() => (isRemove ? onAsk() : onAct(action))}
      >
        {ACTIONS[action].label}
      </Button>
    )
  })

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

type MemberRowProps = {
  member: Account
  isBusy: boolean
  isAsking: boolean
  onAct: (action: ActionKey) => void
  onAsk: () => void
  onCancel: () => void
}

/**
 * One account and what can be done to it. Removing asks first, in the row,
 * with focus on Cancel; cancelled, focus goes back to Remove access. The
 * owner's row has no actions: the owner cannot lose access from here.
 */
const MemberRow = ({ member, isBusy, isAsking, onAct, onAsk, onCancel }: MemberRowProps) => {
  const removeButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  useReturnFocus({ isOpen: isAsking, target: removeButton })
  useEffect(() => {
    if (isAsking) cancelButton.current?.focus()
  }, [isAsking])
  const Actions = MEMBER_ACTIONS[rowStateOf({ member, isAsking })]

  return (
    <li className={usersStyles.member}>
      <span className={usersStyles.email}>{member.email}</span>
      <div className={usersStyles.actions}>
        <Actions
          member={member}
          isBusy={isBusy}
          removeButton={removeButton}
          cancelButton={cancelButton}
          onAct={onAct}
          onAsk={onAsk}
          onCancel={onCancel}
        />
      </div>
    </li>
  )
}

type UsersSectionProps = { userId: string }

/**
 * Who may use this raven, for its owner `userId`: the accounts in three tabs
 * by access, each row with what can be done to it. The server's say-so wins
 * over the account's own flag: a refusal as not the owner takes the section
 * away.
 */
export const UsersSection = ({ userId }: UsersSectionProps) => {
  const headingId = useId()
  const { members, setStatus } = useMembers({ userId })
  const [tab, setTab] = useState<MemberStatus>(MEMBER_STATUSES.pending)
  const [asking, setAsking] = useState<string | null>(null)

  const isRefused =
    members.error instanceof ApiError && members.error.refusal?.reason === AUTH_REFUSALS.notOwner

  const withStatus = (status: MemberStatus) =>
    members.data?.filter((member) => member.status === status) ?? []
  const shown = withStatus(tab)

  type ActProps = { member: Account; action: ActionKey }

  const act = ({ member, action }: ActProps) => {
    setAsking(null)
    setStatus.mutate({ id: member.id, change: { status: ACTIONS[action].status } })
  }

  return (
    !isRefused && (
      <section className={styles.section} aria-labelledby={headingId}>
        <header className={styles.sectionHead}>
          <h2 id={headingId} className={styles.heading}>
            <Titled icon="list">{SETTINGS_COPY.users.heading}</Titled>
          </h2>
          <p className={styles.help}>{SETTINGS_COPY.users.help}</p>
        </header>
        {members.isError && (
          <p className={styles.error} role="alert">
            {members.error.message}
          </p>
        )}
        {setStatus.isError && (
          <p className={styles.error} role="alert">
            {SETTINGS_COPY.users.changeFailed}
            {setStatus.error.message}
          </p>
        )}
        {members.isPending && (
          <Loading label={SETTINGS_COPY.users.reading}>
            <Bone shape="heading" />
            <Bone shape="heading" />
          </Loading>
        )}
        {members.data && (
          <Tabs
            label={SETTINGS_COPY.users.tabs}
            tabs={TABS.map((status) => ({
              value: status,
              label: STATUS_NAMES[status],
              count: withStatus(status).length,
            }))}
            chosen={tab}
            onChoose={setTab}
          >
            {shown.length === 0 && <p className={styles.hint}>{NOBODY[tab]}</p>}
            {shown.length > 0 && (
              <ul className={usersStyles.members}>
                {shown.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isBusy={setStatus.isPending}
                    isAsking={asking === member.id}
                    onAct={(action) => act({ member, action })}
                    onAsk={() => setAsking(member.id)}
                    onCancel={() => setAsking(null)}
                  />
                ))}
              </ul>
            )}
          </Tabs>
        )}
      </section>
    )
  )
}
