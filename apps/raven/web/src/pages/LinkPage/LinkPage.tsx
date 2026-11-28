import { useMutation, useQuery } from '@tanstack/react-query'
import { type ComponentType, type FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DEVICE_LINK_PARAM, cleanDeviceCode, shownDeviceCode } from '@raven/core'
import { BUTTON_TONES, Button } from '@raven/ui'
import { CodeField } from '@/components/AuthScreen/AuthFields'
import {
  Address,
  AuthCard,
  AuthForm,
  Fields,
  Lead,
  Status,
  SubmitButton,
} from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { useAccount } from '@/lib/accessState'
import { useAccountKeeping } from '@/lib/accountData'
import { HOME_PATH } from '@/lib/authRoutes'
import { LINK_COPY } from '@/pages/LinkPage/copy'
import styles from '@/pages/LinkPage/LinkPage.module.scss'

/** The query that asks which device a code belongs to; never kept, since a code is spent in minutes. */
const LINK_QUERY_KEY = 'device-sign-in'

/** Where the page stands with the code in its address. */
const LINK_STATES = {
  /** No code yet, or not a whole one: the page asks for it. */
  enter: 'enter',
  checking: 'checking',
  /** The database knows no such waiting code. */
  unknown: 'unknown',
  confirm: 'confirm',
  approved: 'approved',
  failed: 'failed',
} as const

type LinkState = (typeof LINK_STATES)[keyof typeof LINK_STATES]

type LinkViewProps = {
  /** The whole code in the address, as the TV shows it, or the empty string. */
  shown: string
  deviceName: string
  email: string
  isBusy: boolean
  onEnter: (code: string) => void
  onApprove: () => void
  onCancel: () => void
  onRetry: () => void
}

type CodeFormProps = Pick<LinkViewProps, 'onEnter'> & { title: string; lead: string }

/** Asks for the code by hand, for a phone that opened the address instead of scanning. */
const CodeForm = ({ title, lead, onEnter }: CodeFormProps) => {
  const [typed, setTyped] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onEnter(typed)
  }
  return (
    <AuthForm title={title} lead={<Lead>{lead}</Lead>} onSubmit={submit}>
      <Fields>
        <CodeField label={LINK_COPY.code} value={typed} onChange={setTyped} />
      </Fields>
      <SubmitButton isDisabled={cleanDeviceCode(typed) === null}>{LINK_COPY.continue}</SubmitButton>
    </AuthForm>
  )
}

const Enter = ({ onEnter }: LinkViewProps) => (
  <CodeForm title={LINK_COPY.enterTitle} lead={LINK_COPY.enterLead} onEnter={onEnter} />
)

const Unknown = ({ onEnter }: LinkViewProps) => (
  <CodeForm title={LINK_COPY.unknownTitle} lead={LINK_COPY.unknownLead} onEnter={onEnter} />
)

const Checking = () => (
  <AuthCard title={LINK_COPY.enterTitle} lead={<Status>{LINK_COPY.checking}</Status>} />
)

/*
 * The ask itself. It names the device, the account it would sign in as and the code, because a
 * scanned link says nothing about who made it: the approver checks the code against their own TV.
 */
const Confirm = ({ shown, deviceName, email, isBusy, onApprove, onCancel }: LinkViewProps) => (
  <AuthCard
    title={LINK_COPY.confirmTitle}
    lead={
      <>
        <Lead>
          <Address>{deviceName}</Address>
          {LINK_COPY.wants}
          <Address>{email}</Address>
          {LINK_COPY.wantsEnd}
        </Lead>
        <Lead>{LINK_COPY.onlyIf}</Lead>
        <output className={styles.code}>{shown}</output>
      </>
    }
  >
    <div className={styles.actions}>
      <Button tone={BUTTON_TONES.primary} disabled={isBusy} onClick={onApprove}>
        {isBusy ? LINK_COPY.approving : LINK_COPY.approve}
      </Button>
      <Button disabled={isBusy} onClick={onCancel}>
        {LINK_COPY.cancel}
      </Button>
    </div>
  </AuthCard>
)

const Approved = () => (
  <AuthCard title={LINK_COPY.approvedTitle} lead={<Status>{LINK_COPY.approvedLead}</Status>} />
)

const Failed = ({ onRetry }: LinkViewProps) => (
  <AuthCard title={LINK_COPY.failedTitle} lead={<Status>{LINK_COPY.failedLead}</Status>}>
    <div className={styles.actions}>
      <Button tone={BUTTON_TONES.primary} onClick={onRetry}>
        {LINK_COPY.tryAgain}
      </Button>
    </div>
  </AuthCard>
)

const LINK_VIEWS = {
  [LINK_STATES.enter]: Enter,
  [LINK_STATES.checking]: Checking,
  [LINK_STATES.unknown]: Unknown,
  [LINK_STATES.confirm]: Confirm,
  [LINK_STATES.approved]: Approved,
  [LINK_STATES.failed]: Failed,
} as const satisfies Record<LinkState, ComponentType<LinkViewProps>>

type LinkStateOfProps = {
  canKeep: boolean
  code: string | null
  /** The device the code belongs to: undefined until asked, null when no code waits. */
  deviceName: string | null | undefined
  /** Whether the approval took: undefined until asked. */
  isApproved: boolean | undefined
  isFailed: boolean
}

const linkStateOf = ({
  canKeep,
  code,
  deviceName,
  isApproved,
  isFailed,
}: LinkStateOfProps): LinkState => {
  if (code === null) return LINK_STATES.enter
  // The screen admits only a signed-in account, whose session reaches the store a moment later.
  if (!canKeep) return LINK_STATES.checking
  if (isApproved) return LINK_STATES.approved
  if (isFailed) return LINK_STATES.failed
  // An approval that did not take found the code spent or run out in the meantime.
  if (deviceName === null || isApproved === false) return LINK_STATES.unknown
  return deviceName === undefined ? LINK_STATES.checking : LINK_STATES.confirm
}

/**
 * `/link`: where a phone approves the code a TV shows, opened by the TV's QR code with the code
 * in its address (`?code=`) or typed by hand. It sits behind the gate, which sends a signed-out
 * phone to sign in and back here, so approving is one tap for a phone already signed in. The
 * database's functions do the work (`@raven/core`'s `deviceSignIn.ts`); the page only asks, and
 * says what it is about to let in.
 */
export const LinkPage = () => {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const code = cleanDeviceCode(params.get(DEVICE_LINK_PARAM) ?? '')
  const keeping = useAccountKeeping()
  const email = useAccount().data?.email ?? ''

  const request = useQuery({
    queryKey: [LINK_QUERY_KEY, keeping?.userId ?? null, code],
    queryFn: () => keeping?.client.deviceSignInRequest({ code: code ?? '' }) ?? null,
    enabled: keeping !== null && code !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })
  const approve = useMutation({
    mutationFn: async (approved: string) =>
      (await keeping?.client.approveDeviceSignIn({ code: approved })) ?? false,
  })

  const state = linkStateOf({
    canKeep: keeping !== null,
    code,
    deviceName: request.data,
    isApproved: approve.data,
    isFailed: request.isError || approve.isError,
  })
  const View = LINK_VIEWS[state]

  return (
    <AuthScreen audience={AUDIENCES.anyone}>
      <View
        shown={code === null ? '' : shownDeviceCode(code)}
        deviceName={request.data ?? ''}
        email={email}
        isBusy={approve.isPending}
        onEnter={(typed) => {
          approve.reset()
          setParams({ [DEVICE_LINK_PARAM]: typed }, { replace: true })
        }}
        onApprove={() => {
          if (code !== null) approve.mutate(code)
        }}
        onCancel={() => navigate(HOME_PATH, { replace: true })}
        onRetry={() => {
          approve.reset()
          void request.refetch()
        }}
      />
    </AuthScreen>
  )
}
