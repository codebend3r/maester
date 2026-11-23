import { type ApiClient, type Library, libraryIconOf } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'

import { useOwnerId } from '@/account/useOwnerId'
import { LibrariesPage, LibraryCard, Loading } from '@/layouts'
import type { LibraryCardPin, LibraryCardProps } from '@/layouts/librariesKit'
import type { LoadingProps } from '@/layouts/loadingKit'
import { usePinToggle } from '@/queries/accountPins'
import { type Picture, pictureAt } from '@/queries/cards'
import { librariesSummaryOf, libraryLineOf } from '@/queries/libraryList'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { ROUTE_TARGETS, hrefOf } from '@/routes'
import { LIBRARIES_COPY } from '@/screens/copy'
import { useLibraryCardWork } from '@/screens/libraryCardWork'

/** Whose card it is: the owner's carries the library's buttons, folded away until opened; anyone else's only opens the library. */
const CARD_ROLES = { owner: 'owner', viewer: 'viewer' } as const

type CardRole = (typeof CARD_ROLES)[keyof typeof CARD_ROLES]

/** What every card is drawn from, whoever's it is. */
type LibraryEntryProps = {
  api: ApiClient
  library: Library
  card: Omit<LibraryCardProps, 'toggle' | 'pin' | 'lines' | 'actions'>
  onToggle: () => void
}

/** A card's Pin toggle in the web's words, or null where the account cannot pin. */
const useCardPin = (library: Library): LibraryCardPin | null => {
  const pin = usePinToggle(library.id)
  return (
    pin && {
      text: pin.isPinned ? LIBRARIES_COPY.pinned : LIBRARIES_COPY.pin,
      name: LIBRARIES_COPY.pinName(library.name),
      isPinned: pin.isPinned,
      isDisabled: pin.isFull,
      onPress: pin.toggle,
    }
  )
}

/** The owner's card: the chevron opens its buttons and how its work stands, as the web's card does. */
const OwnerLibraryCard = ({ api, library, card, onToggle }: LibraryEntryProps) => {
  const { actions, lines } = useLibraryCardWork({ api, library })
  const pin = useCardPin(library)
  return (
    <LibraryCard
      {...card}
      pin={pin}
      actions={actions}
      lines={lines}
      toggle={{
        name: card.isOpen
          ? LIBRARIES_COPY.showLess(library.name)
          : LIBRARIES_COPY.showMore(library.name),
        onPress: onToggle,
      }}
    />
  )
}

/** Anyone else's card: its picture, icon, name and counts, pressed to open the library, and Pin. */
const ViewerLibraryCard = ({ library, card }: LibraryEntryProps) => {
  const pin = useCardPin(library)
  return <LibraryCard {...card} actions={[]} lines={[]} pin={pin} toggle={null} />
}

const LIBRARY_CARDS = {
  [CARD_ROLES.owner]: OwnerLibraryCard,
  [CARD_ROLES.viewer]: ViewerLibraryCard,
} as const satisfies Record<CardRole, ComponentType<LibraryEntryProps>>

type LibraryCardsProps = {
  session: AppQueries
  libraries: readonly Library[]
  notice: string | null
}

/** The cards, stacked full width under the title and counts, each opening its library. */
const LibraryCards = ({ session, libraries, notice }: LibraryCardsProps) => {
  const router = useRouter()
  const ownerId = useOwnerId(session)
  const pictures = usePictures({ server: session.server, api: session.api })
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set())
  const Card = LIBRARY_CARDS[ownerId === null ? CARD_ROLES.viewer : CARD_ROLES.owner]
  const pictureOf = ({ backdrop }: Library): Picture | null =>
    backdrop === null || pictures === null
      ? null
      : pictureAt({
          uri: session.api.libraryBackdropUrl(backdrop),
          headersFor: pictures.headersFor,
        })
  const toggle = (id: number) =>
    setOpenIds((open) =>
      open.has(id) ? new Set([...open].filter((each) => each !== id)) : new Set([...open, id]),
    )
  return (
    <LibrariesPage
      line={libraries.length === 0 ? null : librariesSummaryOf(libraries)}
      notice={notice}
      onBack={() => router.back()}
      title={LIBRARIES_COPY.title}
    >
      {libraries.map((library, index) => (
        <Card
          key={library.id}
          api={session.api}
          card={{
            place: `library:${library.id}`,
            name: library.name,
            icon: libraryIconOf(library.settings),
            line: libraryLineOf(library),
            picture: pictureOf(library),
            isFirst: index === 0,
            isOpen: openIds.has(library.id),
            onOpen: () =>
              router.push(
                hrefOf({ kind: ROUTE_TARGETS.library, libraryId: library.id, query: '' }),
              ),
          }}
          library={library}
          onToggle={() => toggle(library.id)}
        />
      ))}
    </LibrariesPage>
  )
}

/** What the page draws: the mark while the libraries are read, then their cards. */
const LIBRARIES_VIEW_KEYS = { loading: 'loading', cards: 'cards' } as const

type LibrariesViewProps = {
  [LIBRARIES_VIEW_KEYS.loading]: LoadingProps
  [LIBRARIES_VIEW_KEYS.cards]: LibraryCardsProps
}

const LIBRARIES_VIEWS = {
  [LIBRARIES_VIEW_KEYS.loading]: Loading,
  [LIBRARIES_VIEW_KEYS.cards]: LibraryCards,
} as const satisfies ViewsOf<LibrariesViewProps>

type ServerLibrariesProps = { session: AppQueries }

const ServerLibraries = ({ session }: ServerLibrariesProps) => {
  const router = useRouter()
  const libraries = useQuery(session.queries.librariesQuery)
  const listed = libraries.data ?? []
  const notice = ((): string | null => {
    if (libraries.error !== null && libraries.data === undefined) return libraries.error.message
    return listed.length === 0 ? LIBRARIES_COPY.none : null
  })()
  const view: ViewOf<LibrariesViewProps> = libraries.isPending
    ? {
        key: LIBRARIES_VIEW_KEYS.loading,
        props: { label: LIBRARIES_COPY.gathering, onBack: () => router.back() },
      }
    : { key: LIBRARIES_VIEW_KEYS.cards, props: { session, libraries: listed, notice } }
  return <KeyedView<LibrariesViewProps> view={view} views={LIBRARIES_VIEWS} />
}

/**
 * `/libraries`: every library the account may see, pinned or not, in the server's order, as
 * the web's Libraries page lays them out: a card each, stacked full width, with its newest
 * video's picture, its icon, its name and its counts, opening it as the side menu's row does (a
 * music library on its albums). The owner's cards also open, by their chevron, onto the
 * library's scans and the rest of its work. Each card's Pin keeps the library in the account's
 * pins for this server, which the menus list and Home's shelves follow. Each server gets a page
 * of its own, which lists that server's libraries only.
 */
export const Libraries = () => {
  const session = useAppQueries()
  return session !== null && <ServerLibraries key={session.server.id} session={session} />
}
