import {
  LIBRARY_VIEWS,
  type LibraryView,
  type MemberRequest,
  type TitleRequestAsk,
  type TitleRequests,
  type Upcoming,
  type UpcomingDetails,
  requestKeyOf,
} from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { useOwnerId } from '@/account/useOwnerId'
import { Grid, ToolButton } from '@/layouts'
import type { Pictures, ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { COMING_SOON_COPY, COMING_SOON_PAGES, type ComingSoonPage } from '@/queries/comingSoonCopy'
import {
  type AccountNames,
  type RequestDetails,
  type RequestsPage,
  accountNamesOf,
  everyoneSectionsOf,
  isRequestsPage,
  lineOf,
  requestSectionsOf,
  requestsOn,
  upcomingSectionsOf,
} from '@/queries/upcomingCards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'
import { APP_ICONS } from '@/theme/icons'

/** Each page's icon on the button that opens it. */
const PAGE_ICONS = {
  [COMING_SOON_PAGES.upcoming]: APP_ICONS.calendar,
  [COMING_SOON_PAGES.pending]: APP_ICONS.download,
  [COMING_SOON_PAGES.added]: APP_ICONS.check,
  [COMING_SOON_PAGES.everyone]: APP_ICONS.list,
} as const satisfies Record<ComingSoonPage, IconName>

/** The pages every account has, in the web's tab order; the owner's All requests comes after them. */
const MEMBER_PAGES = [
  COMING_SOON_PAGES.upcoming,
  COMING_SOON_PAGES.pending,
  COMING_SOON_PAGES.added,
] as const satisfies readonly ComingSoonPage[]

const OWNER_PAGES = [
  ...MEMBER_PAGES,
  COMING_SOON_PAGES.everyone,
] as const satisfies readonly ComingSoonPage[]

/** What a page reads and draws from. */
type PageReads = Pictures & {
  upcoming: UseQueryResult<Upcoming>
  requests: UseQueryResult<TitleRequests>
  everyone: UseQueryResult<MemberRequest[]>
  details: RequestDetails
  names: AccountNames
}

/** A page as the grid draws it: its cards, how they are laid out, the line under the title, and what stands in for no cards. */
type PageBody = {
  sections: GridSection[]
  view: LibraryView
  line: string | null
  /** What the page says while it is read, once it failed, and when it holds nothing. */
  words: { reading: string; failed: string; none: string }
  read: Pick<UseQueryResult, 'isPending' | 'error'>
}

type RequestsBodyProps = { page: RequestsPage; reads: PageReads }

const requestsBody = ({ page, reads }: RequestsBodyProps): PageBody => ({
  sections: requestSectionsOf({
    page,
    list: reads.requests.data,
    details: reads.details,
    api: reads.api,
    headersFor: reads.headersFor,
  }),
  view: LIBRARY_VIEWS.grid,
  line:
    page === COMING_SOON_PAGES.pending && reads.requests.data !== undefined
      ? COMING_SOON_COPY.request.left(reads.requests.data.budget)
      : null,
  words: {
    reading: COMING_SOON_COPY.requests.reading,
    failed: COMING_SOON_COPY.requests.failed,
    none: COMING_SOON_COPY.requests.none[page],
  },
  read: reads.requests,
})

/** Each page's body, from what the screen read. */
const PAGE_BODIES = {
  [COMING_SOON_PAGES.upcoming]: (reads: PageReads): PageBody => ({
    sections:
      reads.upcoming.data === undefined
        ? []
        : upcomingSectionsOf({
            upcoming: reads.upcoming.data,
            list: reads.requests.data,
            api: reads.api,
            headersFor: reads.headersFor,
          }),
    view: LIBRARY_VIEWS.grid,
    line: COMING_SOON_COPY.intro,
    words: { reading: COMING_SOON_COPY.loading, failed: '', none: COMING_SOON_COPY.empty },
    read: reads.upcoming,
  }),
  [COMING_SOON_PAGES.pending]: (reads: PageReads): PageBody =>
    requestsBody({ page: COMING_SOON_PAGES.pending, reads }),
  [COMING_SOON_PAGES.added]: (reads: PageReads): PageBody =>
    requestsBody({ page: COMING_SOON_PAGES.added, reads }),
  [COMING_SOON_PAGES.everyone]: (reads: PageReads): PageBody => ({
    sections: everyoneSectionsOf({ requests: reads.everyone.data ?? [], names: reads.names }),
    view: LIBRARY_VIEWS.list,
    line: null,
    words: {
      reading: COMING_SOON_COPY.everyone.reading,
      failed: COMING_SOON_COPY.everyone.failed,
      none: COMING_SOON_COPY.everyone.none,
    },
    read: reads.everyone,
  }),
} as const satisfies Record<ComingSoonPage, (reads: PageReads) => PageBody>

/** What stands in place of the cards: nothing with some, else that they are read, why not, or that there are none. */
const noticeOf = ({ sections, words, read }: PageBody): string | null => {
  if (sections.length > 0) return null
  if (read.error !== null) return `${words.failed}${read.error.message}`
  return read.isPending ? words.reading : words.none
}

type AsksOnProps = { page: ComingSoonPage; list: TitleRequests | undefined }

/** The requested titles a page shows as posters, each read from the title's own details; All requests is rows of words. */
const asksOn = ({ page, list }: AsksOnProps): TitleRequestAsk[] =>
  isRequestsPage(page)
    ? requestsOn({ page, list }).map(({ type, tmdbId }) => ({ type, tmdbId }))
    : []

type ServerComingSoonProps = { session: AppQueries }

const ServerComingSoon = ({ session }: ServerComingSoonProps) => {
  const { server, api, queries } = session
  const router = useRouter()
  const ownerId = useOwnerId(session)
  const [page, setPage] = useState<ComingSoonPage>(COMING_SOON_PAGES.upcoming)
  const pictures = usePictures({ server, api })
  const upcoming = useQuery(queries.upcomingQuery)
  const requests = useQuery(queries.requestsQuery)
  // Only the owner is ever asked for every account's requests, and only on their page.
  const isEveryones = ownerId !== null && page === COMING_SOON_PAGES.everyone
  const everyone = useQuery({ ...queries.everyonesRequestsQuery, enabled: isEveryones })
  const members = useQuery(queries.membersQuery(isEveryones ? ownerId : null))
  const asks = asksOn({ page, list: requests.data })
  const titles = useQueries({ queries: asks.map((ask) => queries.upcomingDetailsQuery(ask)) })
  const details = new Map(
    titles.flatMap(({ data }): [string, UpcomingDetails][] =>
      data === undefined ? [] : [[requestKeyOf(data), data]],
    ),
  )
  const names = accountNamesOf(members.data)
  const pages: readonly ComingSoonPage[] = ownerId === null ? MEMBER_PAGES : OWNER_PAGES
  const body =
    pictures === null
      ? null
      : PAGE_BODIES[page]({ upcoming, requests, everyone, details, names, ...pictures })

  return (
    <Grid
      hasPosterCaptions
      icon={null}
      jump={null}
      line={lineOf([COMING_SOON_COPY.pages[page], body?.line ?? null])}
      notice={body === null ? COMING_SOON_COPY.loading : noticeOf(body)}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={null}
      sections={body?.sections ?? []}
      title={COMING_SOON_COPY.title}
      toolbar={pages
        .filter((other) => other !== page)
        .map((other) => (
          <ToolButton
            key={other}
            accessibilityLabel={COMING_SOON_COPY.showPage(COMING_SOON_COPY.pages[other])}
            icon={PAGE_ICONS[other]}
            label={COMING_SOON_COPY.pages[other]}
            onPress={() => setPage(other)}
          />
        ))}
      view={body?.view ?? LIBRARY_VIEWS.grid}
    />
  )
}

/**
 * `/coming-soon`: the web's Coming soon, its tabs as pages a button apiece, as a library's are.
 * Upcoming is what TMDB says is on its way, a run of posters each for movies, TV shows,
 * documentaries and anime; Pending is the caller's requests, and the titles the downloaders hold
 * already, that are still on their way, under how many requests are left today; Requests Added
 * is those a library holds now or that have downloaded; and the owner has All requests, every
 * account's and whose each was, a row each. A card opens the title's own page, or the title in
 * its library once it is there. Each server gets a page of its own.
 */
export const ComingSoon = () => {
  const session = useAppQueries()
  return session !== null && <ServerComingSoon key={session.server.id} session={session} />
}
