import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from '@tanstack/react-query'
import {
  type Account,
  PLAY_HISTORY_SHOWS,
  type PlayHistoryPage as HistoryPage,
  type PlayHistoryShow,
  isPlayHistoryShow,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ForManagers } from '@/components/ManagersOnly/ManagersOnly'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useManagement } from '@/lib/management'
import { everyonesHistoryQuery, playHistoryQuery } from '@/lib/queries'
import { PLAY_HISTORY_SEARCH } from '@/lib/playHistory'
import { type AccountName, accountNamesOf, useAccounts } from '@/lib/useAccounts'
import { useAddressValue } from '@/lib/useAddressValue'
import { PLAY_HISTORY_COPY } from '@/pages/PlayHistoryPage/copy'
import { PlayHistoryTable } from '@/pages/PlayHistoryPage/PlayHistoryTable'
import styles from '@/pages/PlayHistoryPage/PlayHistoryPage.module.scss'
import { APP_PATHS } from '@/lib/appPaths'

type HistoryQuery = UseInfiniteQueryResult<InfiniteData<HistoryPage>>

type ShowState = [PlayHistoryShow, (show: PlayHistoryShow) => void]

/** What the address asks the history to show; everything unless it names a kind, which it leaves out. */
const useShow = (): ShowState => {
  const [asked, setAsked] = useAddressValue(PLAY_HISTORY_SEARCH.show)
  const show = isPlayHistoryShow(asked) ? asked : PLAY_HISTORY_SHOWS.all
  return [show, (next) => setAsked(next === PLAY_HISTORY_SHOWS.all ? null : next)]
}

type ShowSwitchProps = { show: PlayHistoryShow; onShow: (show: PlayHistoryShow) => void }

/** Everything, videos or music, as a well of buttons with the one shown filled in. */
const ShowSwitch = ({ show, onShow }: ShowSwitchProps) => (
  <fieldset className={styles.shows}>
    <legend className="visually-hidden">{PLAY_HISTORY_COPY.show}</legend>
    {isPlayHistoryShow.values.map((option) => (
      <button
        key={option}
        type="button"
        className={styles.show}
        aria-pressed={show === option}
        onClick={() => onShow(option)}
      >
        {PLAY_HISTORY_COPY.shows[option]}
      </button>
    ))}
  </fieldset>
)

/** Rows on their way, laid out as the table lays them. */
const RowsSkeleton = () => (
  <Loading label={PLAY_HISTORY_COPY.loading}>
    <ul className={styles.bones}>
      {['first', 'second', 'third', 'fourth'].map((row) => (
        <li key={row} className={styles.bone}>
          <Bone shape="small" width="short" />
          <Bone shape="text" width="most" />
        </li>
      ))}
    </ul>
  </Loading>
)

type HistoryResultsProps = {
  history: HistoryQuery
  show: PlayHistoryShow
  nameOf: AccountName | null
}

/** The history's pages as one table, with what went wrong, what is on its way, and more on request. */
const HistoryResults = ({ history, show, nameOf }: HistoryResultsProps) => {
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? []
  return (
    <>
      {history.isError && (
        <p className={styles.message} role="alert">
          {PLAY_HISTORY_COPY.serverDidNotAnswer}
          {history.error.message}
        </p>
      )}
      {history.isPending && <RowsSkeleton />}
      {history.isSuccess && entries.length === 0 && (
        <p className={styles.message}>
          {show === PLAY_HISTORY_SHOWS.all
            ? PLAY_HISTORY_COPY.nothing
            : PLAY_HISTORY_COPY.nothingOfKind}
        </p>
      )}
      {entries.length > 0 && <PlayHistoryTable entries={entries} nameOf={nameOf} />}
      {history.hasNextPage && (
        <Button
          className={styles.more}
          disabled={history.isFetchingNextPage}
          onClick={() => {
            history.fetchNextPage().catch(() => undefined)
          }}
        >
          {PLAY_HISTORY_COPY.more}
        </Button>
      )}
    </>
  )
}

type HistoryHeaderProps = {
  titleId: string
  title: string
  intro: string
  /** A link the page offers beside its title. */
  action?: ReactNode
}

/** A history page's top: the way back, its title and what it holds. */
const HistoryHeader = ({ titleId, title, intro, action }: HistoryHeaderProps) => (
  <header className={styles.header}>
    <BackButton fallback={HOME} className={styles.back} />
    <hgroup className={styles.heading}>
      <PageTitle id={titleId} icon="history">
        {title}
      </PageTitle>
      <p className={styles.intro}>{intro}</p>
    </hgroup>
    {action}
  </header>
)

/**
 * `/history`: everything the signed-in account played, newest first, every
 * video and every track however briefly, as a plain table. Only ever the
 * account's own: the server answers no one else's here.
 */
export const PlayHistoryPage = () => {
  const titleId = useId()
  const [show, setShow] = useShow()
  const history = useInfiniteQuery(playHistoryQuery(show))
  const { canManage } = useManagement()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <HistoryHeader
        titleId={titleId}
        title={PLAY_HISTORY_COPY.title}
        intro={PLAY_HISTORY_COPY.intro}
        action={
          canManage && (
            <Link className={styles.everyone} to={APP_PATHS.everyonesHistory}>
              {PLAY_HISTORY_COPY.seeEveryone}
            </Link>
          )
        }
      />
      <ShowSwitch show={show} onShow={setShow} />
      <HistoryResults history={history} show={show} nameOf={null} />
    </section>
  )
}

type AccountPickerProps = {
  accounts: readonly Account[]
  accountId: string | null
  onAccount: (accountId: string | null) => void
}

/** Whose history the owner reads: everyone's, or one account's. */
const AccountPicker = ({ accounts, accountId, onAccount }: AccountPickerProps) => {
  const id = useId()
  return (
    <div className={styles.picker}>
      <label htmlFor={id}>{PLAY_HISTORY_COPY.account}</label>
      <select
        id={id}
        value={accountId ?? ''}
        onChange={(event) => onAccount(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{PLAY_HISTORY_COPY.everyone}</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.email}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Everyone's history once the viewer may manage: whose to read, what to show, and the table with an account column. */
const EveryoneHistory = () => {
  const titleId = useId()
  const [show, setShow] = useShow()
  const [accountId, setAccount] = useAddressValue(PLAY_HISTORY_SEARCH.account)
  const accounts = useAccounts()
  const history = useInfiniteQuery(everyonesHistoryQuery({ accountId, show }))
  const nameOf = accountNamesOf({ accounts, thisServer: PLAY_HISTORY_COPY.thisServer })
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <HistoryHeader
        titleId={titleId}
        title={PLAY_HISTORY_COPY.everyoneTitle}
        intro={PLAY_HISTORY_COPY.everyoneIntro}
      />
      <div className={styles.filters}>
        <ShowSwitch show={show} onShow={setShow} />
        {accounts.length > 0 && (
          <AccountPicker accounts={accounts} accountId={accountId} onAccount={setAccount} />
        )}
      </div>
      <HistoryResults history={history} show={show} nameOf={nameOf} />
    </section>
  )
}

/**
 * `/history/everyone`: what every account played, for the owner (or the
 * admin, on a server without accounts), with each entry's account and a
 * picker for one account's. Anyone else is told it is the owner's, and
 * nothing is asked of the server, which refuses them anyway.
 */
export const EveryonesHistoryPage = () => (
  <ForManagers
    name={PLAY_HISTORY_COPY.everyoneTitle}
    forAdmin={PLAY_HISTORY_COPY.managersOnlyFor}
    forOwner={PLAY_HISTORY_COPY.managersOnlyFor}
  >
    <EveryoneHistory />
  </ForManagers>
)
