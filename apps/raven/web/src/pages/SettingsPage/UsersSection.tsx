import { useEffect, useId, useRef, useState } from 'react'
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
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import usersStyles from '@/pages/SettingsPage/UsersSection.module.scss'

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
    if (member.isOwner) return <span className={usersStyles.aside}>Owner</span>
    if (isAsking) {
      return (
        <>
          <p className={usersStyles.aside}>Remove access for this account?</p>
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
    return ROW_ACTIONS[member.status].map((action) => {
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
  }

  return (
    <li className={usersStyles.member}>
      <span className={usersStyles.email}>{member.email}</span>
      <div className={usersStyles.actions}>{actions()}</div>
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

  if (
    members.error instanceof ApiError &&
    members.error.refusal?.reason === AUTH_REFUSALS.notOwner
  ) {
    return null
  }

  const withStatus = (status: MemberStatus) =>
    members.data?.filter((member) => member.status === status) ?? []
  const shown = withStatus(tab)

  type ActProps = { member: Account; action: ActionKey }

  const act = ({ member, action }: ActProps) => {
    setAsking(null)
    setStatus.mutate({ id: member.id, change: { status: ACTIONS[action].status } })
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
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
        <Tabs
          label="Accounts"
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
}
