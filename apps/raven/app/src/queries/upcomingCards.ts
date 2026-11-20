import {
  CREDIT_JOBS,
  type Credit,
  type MemberRequest,
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  UPCOMING_SHELVES,
  type Upcoming,
  type UpcomingDetails,
  type UpcomingShelf,
  type UpcomingTitle,
  addedRequestsOf,
  castMembers,
  formatAirDate,
  initialsOf,
  isAccountId,
  isLibraryRequest,
  pendingRequestsOf,
  requestKeyOf,
  requestOf,
} from '@raven/core'

import { CARD_SHAPES, type Pictures, type ShelfCard, pictureAt } from '@/queries/cards'
import { COMING_SOON_COPY, COMING_SOON_PAGES, type ComingSoonPage } from '@/queries/comingSoonCopy'
import type { ItemPage, PersonCard } from '@/queries/itemPage'
import type { GridSection } from '@/queries/libraryGrid'
import { joinedOrNull, present } from '@/queries/lines'
import { ROUTE_TARGETS, type RouteTarget, itemTarget } from '@/routes'

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const momentFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** "18 Feb 2026, 15:00" from an ISO time. */
const momentOf = (at: string): string => momentFormat.format(new Date(at))

/** "18 Feb 2026" from an ISO time. */
export const dayOf = (at: string): string => dayFormat.format(new Date(at))

/** Whether a shelf's cards say if each is a movie or a show: only where it holds both. */
const SHOWS_KIND = {
  [UPCOMING_SHELVES.movies]: false,
  [UPCOMING_SHELVES.shows]: false,
  [UPCOMING_SHELVES.documentaries]: true,
  [UPCOMING_SHELVES.anime]: true,
} as const satisfies Record<UpcomingShelf, boolean>

/** The page's shelves, top to bottom, as the web's. */
const SHELF_ORDER = [
  UPCOMING_SHELVES.movies,
  UPCOMING_SHELVES.shows,
  UPCOMING_SHELVES.documentaries,
  UPCOMING_SHELVES.anime,
] as const satisfies readonly UpcomingShelf[]

/** The parts that say something, joined as one of Coming soon's lines; null when none does. */
export const lineOf = (parts: readonly (string | null)[]): string | null =>
  joinedOrNull({ parts, separator: COMING_SOON_COPY.separator })

type PosterOfProps = Pictures & { poster: string | null }

/** A TMDB poster through the server's image cache, at the width a card needs. */
const posterOf = ({ poster, api, headersFor }: PosterOfProps) =>
  pictureAt({ uri: poster === null ? null : api.tmdbPosterSources(poster).src, headersFor })

/** A title's own Coming soon page. */
const upcomingTarget = ({ type, tmdbId }: TitleRequestAsk): RouteTarget => ({
  kind: ROUTE_TARGETS.upcoming,
  title: { type, tmdbId },
})

type PosterCardProps = Pick<ShelfCard, 'key' | 'title' | 'line' | 'picture' | 'target'>

/** A title on its way as a poster card: nothing to resume, mark or open a menu on. */
const posterCard = (card: PosterCardProps): ShelfCard => ({
  ...card,
  shape: CARD_SHAPES.poster,
  progress: 0,
  subject: null,
  isWatched: false,
})

type OneRunProps = { key: string; cards: ShelfCard[] }

/** A page that is one run of cards under no heading; no section with no card. */
const oneRun = ({ key, cards }: OneRunProps): GridSection[] =>
  cards.length === 0 ? [] : [{ key, title: null, count: null, shape: CARD_SHAPES.poster, cards }]

type UpcomingCardProps = Pictures & {
  title: UpcomingTitle
  shelf: UpcomingShelf
  list: TitleRequests | undefined
}

/**
 * A title still to come as a library's poster card, the web's: its poster and name over the day
 * it comes out, its kind on a shelf that holds both, and where its request stands once someone
 * made one. It opens the title's own page, where it can be requested.
 */
const upcomingCard = ({ title, shelf, list, api, headersFor }: UpcomingCardProps): ShelfCard => {
  const request = requestOf({ list, ask: title })
  return posterCard({
    key: `upcoming:${shelf}:${requestKeyOf(title)}`,
    title: title.title,
    // Where its request stands comes first: a card's line is cut at its width.
    line: lineOf([
      request === null ? null : COMING_SOON_COPY.statuses[request.status].label,
      formatAirDate(title.released),
      SHOWS_KIND[shelf] ? COMING_SOON_COPY.kinds[title.type] : null,
    ]),
    picture: posterOf({ poster: title.poster, api, headersFor }),
    target: upcomingTarget(title),
  })
}

type UpcomingSectionsOfProps = Pictures & {
  upcoming: Upcoming
  list: TitleRequests | undefined
}

/**
 * The Upcoming page: movies, TV shows, documentaries and anime, each a run of posters under its
 * heading, the most popular first; a shelf with nothing announced is left out. An older server
 * sends no anime.
 */
export const upcomingSectionsOf = ({
  upcoming,
  list,
  api,
  headersFor,
}: UpcomingSectionsOfProps): GridSection[] =>
  SHELF_ORDER.flatMap((shelf) => {
    const titles = upcoming[shelf] ?? []
    return titles.length === 0
      ? []
      : [
          {
            key: shelf,
            title: COMING_SOON_COPY.shelves[shelf],
            count: null,
            shape: CARD_SHAPES.poster,
            isOpenFirst: true,
            cards: titles.map((title) => upcomingCard({ title, shelf, list, api, headersFor })),
          },
        ]
  })

/** Each requested title's TMDB details, by its request's key, once read: its poster and the day it comes out. */
export type RequestDetails = ReadonlyMap<string, UpcomingDetails>

/** Where a request's card leads: the title in its library once a scan added it, else its Coming soon page. */
const requestTargetOf = (request: TitleRequest): RouteTarget =>
  isLibraryRequest(request) ? itemTarget(request.libraryItemId) : upcomingTarget(request)

/** What a request's card says of where it stands: in the library, or how far its download got. */
const requestStandingOf = (request: TitleRequest): string =>
  isLibraryRequest(request)
    ? COMING_SOON_COPY.requests.inLibrary
    : COMING_SOON_COPY.statuses[request.status].label

type RequestCardProps = Pictures & { request: TitleRequest; details: RequestDetails }

/** One request as a poster card, the web's: its kind, the day it comes out, the day it was asked for and where it stands. */
const requestCard = ({ request, details, api, headersFor }: RequestCardProps): ShelfCard => {
  const title = details.get(requestKeyOf(request)) ?? null
  return posterCard({
    key: `request:${requestKeyOf(request)}`,
    title: request.title,
    // Where it stands comes first: a card's line is cut at its width.
    line: lineOf([
      requestStandingOf(request),
      COMING_SOON_COPY.kinds[request.type],
      formatAirDate(title?.released ?? null),
      COMING_SOON_COPY.requests.requestedOn(dayOf(request.requestedAt)),
    ]),
    picture: posterOf({ poster: title?.poster ?? null, api, headersFor }),
    target: requestTargetOf(request),
  })
}

/** Which of the caller's requests each of the two request pages holds. */
const REQUEST_PICKS = {
  [COMING_SOON_PAGES.pending]: pendingRequestsOf,
  [COMING_SOON_PAGES.added]: addedRequestsOf,
} as const

export type RequestsPage = keyof typeof REQUEST_PICKS

/** Whether a page lists the caller's own requests, each a poster read from its title's details. */
export const isRequestsPage = (page: ComingSoonPage): page is RequestsPage =>
  Object.hasOwn(REQUEST_PICKS, page)

type RequestsOnProps = { page: RequestsPage; list: TitleRequests | undefined }

/** The requests a page holds, newest first as the server lists them. */
export const requestsOn = ({ page, list }: RequestsOnProps): TitleRequest[] =>
  REQUEST_PICKS[page](list)

type RequestSectionsOfProps = Pictures & {
  page: RequestsPage
  list: TitleRequests | undefined
  details: RequestDetails
}

/** The Pending or Requests Added page: the caller's titles on their way as one run of posters; none with none. */
export const requestSectionsOf = ({
  page,
  list,
  details,
  api,
  headersFor,
}: RequestSectionsOfProps): GridSection[] =>
  oneRun({
    key: page,
    cards: requestsOn({ page, list }).map((request) =>
      requestCard({ request, details, api, headersFor }),
    ),
  })

/** An account's name by its id, as the owner reads it: its email, or the id while unknown. */
export type AccountNames = ReadonlyMap<string, string>

type NamedMember = { id: string; email: string }

/** The members' emails by account id; none while the members are not read. */
export const accountNamesOf = (members: readonly NamedMember[] | undefined): AccountNames =>
  new Map((members ?? []).map(({ id, email }) => [id, email]))

type AccountNameOfProps = { id: string; names: AccountNames }

/** An account as the owner reads it: its email, its id while its email is unknown, as the web's, else this server's one account. */
const accountNameOf = ({ id, names }: AccountNameOfProps): string => {
  const email = names.get(id) ?? null
  if (email !== null) return email
  return isAccountId(id) ? id : COMING_SOON_COPY.everyone.thisServer
}

type MemberRequesterOfProps = { request: MemberRequest; names: AccountNames }

/** Who put a title on its way: the account that asked, or the downloader that took it on with nobody asking. */
export const memberRequesterOf = ({ request, names }: MemberRequesterOfProps): string =>
  request.requestedBy === null
    ? COMING_SOON_COPY.everyone.downloaders[request.type]
    : accountNameOf({ id: request.requestedBy, names })

type EveryoneSectionsOfProps = { requests: readonly MemberRequest[]; names: AccountNames }

/**
 * The owner's All requests page: every request any account made and every held title, newest
 * first, a row each: its name, then how far its download got, whose it was and when. A row is
 * words alone, so no poster is read for it.
 */
export const everyoneSectionsOf = ({ requests, names }: EveryoneSectionsOfProps): GridSection[] =>
  oneRun({
    key: COMING_SOON_PAGES.everyone,
    cards: requests.map((request) =>
      posterCard({
        key: `everyone:${requestKeyOf(request)}`,
        title: request.title,
        line: lineOf([
          COMING_SOON_COPY.statuses[request.status].label,
          memberRequesterOf({ request, names }),
          momentOf(request.requestedAt),
        ]),
        picture: null,
        target: requestTargetOf(request),
      }),
    ),
  })

/** "A", "A and B" or "A, B, and C": Hermes has no `Intl.ListFormat`, which words the web's list. */
const namesListOf = (names: readonly string[]): string => {
  if (names.length <= 2) return names.join(COMING_SOON_COPY.and)
  return `${names.slice(0, -1).join(COMING_SOON_COPY.listSeparator)}${COMING_SOON_COPY.lastAnd}${names.at(-1) ?? ''}`
}

/** The directors' names as one run of text, each once, or null when TMDB names none. */
const directorsOf = (credits: readonly Credit[]): string | null => {
  const names = credits
    .filter((credit) => credit.job === CREDIT_JOBS.director)
    .map((credit) => credit.name)
    .filter((name, index, all) => all.indexOf(name) === index)
  return names.length === 0 ? null : namesListOf(names)
}

/** The jobs the cast row shows; the directors are named in the byline instead. */
const ACTING_JOBS: ReadonlySet<Credit['job']> = new Set([CREDIT_JOBS.cast, CREDIT_JOBS.guest])

/** What the title is: a movie, a show, a documentary or anime as the server names it, else its type alone from an older server. */
const kindOf = ({ kind, type }: UpcomingDetails): string =>
  kind === undefined ? COMING_SOON_COPY.kinds[type] : COMING_SOON_COPY.upcomingKinds[kind]

type UpcomingPageOfProps = Pictures & {
  details: UpcomingDetails
  /** What the page says under its request button: where the request stands, who asked, what is left today. */
  notes: readonly string[]
}

/**
 * An upcoming title's own page as an item's page draws it, the web's: its backdrop and poster,
 * its name and tagline, the day it comes out with its kind, length and genres, its directors,
 * its summary and its cast. It has no file, version, season or episode.
 */
export const upcomingPageOf = ({
  details,
  notes,
  api,
  headersFor,
}: UpcomingPageOfProps): ItemPage => {
  const credits = details.credits ?? []
  const directors = directorsOf(credits)
  return {
    hero: {
      eyebrow: COMING_SOON_COPY.title,
      logo: null,
      home: null,
      title: details.title,
      byline: directors === null ? null : COMING_SOON_COPY.directedBy(directors),
      rating: null,
      ratings: [],
      facts: present([
        formatAirDate(details.released),
        kindOf(details),
        details.runtime === null ? null : COMING_SOON_COPY.minutes(details.runtime),
        ...details.genres,
      ]),
      progress: null,
      poster: {
        shape: CARD_SHAPES.poster,
        picture: posterOf({ poster: details.poster, api, headersFor }),
      },
      backdrop: pictureAt({
        uri: details.backdrop === null ? null : api.tmdbBackdropUrl(details.backdrop),
        headersFor,
      }),
      tagline: details.tagline,
      summary: details.summary,
      notes,
    },
    file: [],
    versions: [],
    seasons: [],
    episodes: [],
    castTitle: COMING_SOON_COPY.cast,
    cast: castMembers(credits.filter((credit) => ACTING_JOBS.has(credit.job))).map(
      (member): PersonCard => ({
        key: String(member.personId),
        name: member.name,
        role: member.roles.join(' / '),
        initials: initialsOf(member.name),
        picture: pictureAt({ uri: api.photoUrl(member), headersFor }),
      }),
    ),
  }
}
