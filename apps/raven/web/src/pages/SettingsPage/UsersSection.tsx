import { useEffect, useId, useRef, useState } from 'react'
import {
  type Account,
  type MemberStatusChange,
  ApiError,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
} from '@raven/core'
import { Button, KEYS } from '@raven/ui'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { useMembers } from '@/lib/useMembers'
import { useReturnFocus } from '@/lib/useReturnFocus'
import { type MemberStatus, STATUS_NAMES } from '@/pages/SettingsPage/memberStatus'
import { Titled } from '@/pages/SettingsPage/Titled'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

const TABS: readonly MemberStatus[] = Object.values(MEMBER_STATUSES)

const NOBODY = {
  [MEMBER_STATUSES.pending]: 'No one is waiting for approval.',
  [MEMBER_STATUSES.approved]: 'No one is approved yet.',
  [MEMBER_STATUSES.revoked]: 'No one has been removed.',
} as const satisfies Record<MemberStatus, string>

const ACTION_KEYS = { approve: 'approve', remove: 'remove' } as const
type ActionKey = (typeof ACTION_KEYS)[keyof typeof ACTION_KEYS]

/** What each action says, which status it leaves the account in, and how a screen reader names it among many rows. */
const ACTIONS = {
  [ACTION_KEYS.approve]: {
    label: 'Approve',
    status: MEMBER_STATUSES.approved,
    nameFor: (email: string) => `Approve ${email}`,
  },
  [ACTION_KEYS.remove]: {
    label: 'Remove access',
    status: MEMBER_STATUSES.revoked,
    nameFor: (email: string) => `Remove access for ${email}`,
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

type RowProps = {
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
const MemberRow = ({ member, isBusy, isAsking, onAct, onAsk, onCancel }: RowProps) => {
  const removeButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  useReturnFocus({ isOpen: isAsking, target: removeButton })
  useEffect(() => {
    if (isAsking) cancelButton.current?.focus()
  }, [isAsking])

  const actions = () => {
    if (member.isOwner) return <span className={styles.owner}>Owner</span>
    if (isAsking) {
      return (
        <>
          <p className={styles.ask}>Remove access for this account?</p>
          <Button
            tone="danger"
            disabled={isBusy}
            aria-label={`Yes, remove access for ${member.email}`}
            onClick={() => onAct(ACTION_KEYS.remove)}
          >
            Yes, remove
          </Button>
          <Button
            ref={cancelButton}
            aria-label={`Cancel removing ${member.email}`}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </>
      )
    }
    return ROW_ACTIONS[member.status].map((action) => (
      <Button
        key={action}
        ref={action === ACTION_KEYS.remove ? removeButton : undefined}
        tone={action === ACTION_KEYS.approve ? 'primary' : 'quiet'}
        disabled={isBusy}
        aria-label={ACTIONS[action].nameFor(member.email)}
        onClick={() => (action === ACTION_KEYS.remove ? onAsk() : onAct(action))}
      >
        {ACTIONS[action].label}
      </Button>
    ))
  }

  return (
    <li className={styles.member}>
      <span className={styles.memberEmail}>{member.email}</span>
      <div className={styles.memberActions}>{actions()}</div>
    </li>
  )
}

const Users = ({ userId }: { userId: string }) => {
  const ids = { heading: useId(), tabs: useId() }
  const { members, setStatus } = useMembers({ userId })
  const [tab, setTab] = useState<MemberStatus>(MEMBER_STATUSES.pending)
  const [asking, setAsking] = useState<string | null>(null)

  if (
    members.error instanceof ApiError &&
    members.error.refusal?.reason === AUTH_REFUSALS.notOwner
  ) {
    return null
  }

  const shown = members.data?.filter((member) => member.status === tab) ?? []

  const act = ({ member, action }: { member: Account; action: ActionKey }) => {
    setAsking(null)
    setStatus.mutate({ id: member.id, change: { status: ACTIONS[action].status } })
  }

  return (
    <section className={styles.section} aria-labelledby={ids.heading}>
      <header className={styles.sectionHead}>
        <h2 id={ids.heading} className={styles.heading}>
          <Titled icon="list">Users</Titled>
        </h2>
        <p className={styles.help}>
          Who may use this raven. Each new account waits here until you approve it.
        </p>
      </header>
      {members.isError && (
        <p className={styles.error} role="alert">
          {members.error.message}
        </p>
      )}
      {setStatus.isError && (
        <p className={styles.error} role="alert">
          Could not change access: {setStatus.error.message}
        </p>
      )}
      {members.isPending && (
        <Loading label="Reading the accounts">
          <Bone shape="heading" />
          <Bone shape="heading" />
        </Loading>
      )}
      {members.data && (
        <div className={styles.accounts}>
          <div role="tablist" aria-label="Accounts" className={styles.tabs}>
            {TABS.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                id={`${ids.tabs}-${status}`}
                aria-selected={tab === status}
                aria-controls={`${ids.tabs}-panel`}
                tabIndex={tab === status ? 0 : -1}
                className={styles.tab}
                onClick={() => setTab(status)}
                onKeyDown={(event) => {
                  if (event.key !== KEYS.arrowLeft && event.key !== KEYS.arrowRight) return
                  event.preventDefault()
                  const step = event.key === KEYS.arrowRight ? 1 : TABS.length - 1
                  const next = TABS[(TABS.indexOf(status) + step) % TABS.length] ?? status
                  setTab(next)
                  document.getElementById(`${ids.tabs}-${next}`)?.focus()
                }}
              >
                {STATUS_NAMES[status]}
                <span className={styles.tabCount}>
                  {members.data.filter((member) => member.status === status).length}
                </span>
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${ids.tabs}-panel`}
            aria-labelledby={`${ids.tabs}-${tab}`}
            className={styles.panel}
          >
            {shown.length === 0 && <p className={styles.hint}>{NOBODY[tab]}</p>}
            {shown.length > 0 && (
              <ul className={styles.members}>
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
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Who may use this raven, for its owner: the accounts in three tabs by
 * access, each row with what can be done to it. Anyone else never sees it,
 * and the server's say-so wins over the account's own flag: a refusal as
 * not the owner takes the section away.
 */
export const UsersSection = () => {
  const access = useAccessState()
  if (access.kind !== ACCESS_KINDS.approved || !access.account.isOwner) return null
  return <Users key={access.account.id} userId={access.account.id} />
}
