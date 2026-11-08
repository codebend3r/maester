import type { AlbumDetails, ItemDetails, MediaItem } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf, useServerAlbumFavourite } from '@raven/ui/headless'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import {
  type CardMenuOption,
  bingeOptionOf,
  favouriteOptionOf,
  readingNoteOf,
  watchedOptionOf,
} from '@/cardMenu/menuOptions'
import { CardMenuList } from '@/layouts/CardMenu.focus'
import { CARD_SUBJECTS, type CardSubject } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useItemMarks, useVideoMarks } from '@/queries/useMarks'

/** What every menu is handed: the card's title over it, the server, and the way to close it. */
type MenuProps = { title: string; session: AppQueries; onClose: () => void }

/** Whether a menu's title is still being read, or is there to mark. */
const MENU_READS = { reading: 'reading', ready: 'ready' } as const

type ReadingMenuProps = Pick<MenuProps, 'title' | 'onClose'> & { note: string }

/** The menu while its title is read, or once the read failed: the title and a line, no marks. */
const ReadingMenu = ({ title, note, onClose }: ReadingMenuProps) => (
  <CardMenuList note={note} onClose={onClose} options={[]} title={title} />
)

/** What a menu's marks are drawn from once its title is read. */
type ReadyProps<Data> = MenuProps & { data: Data }

type ReadyMenuProps<Data> = ReadyProps<Data> & { Ready: ComponentType<ReadyProps<Data>> }

/** The menu once its title is read: the marks `Ready` draws from what was read. */
const ReadyMenu = <Data,>({ Ready, ...props }: ReadyMenuProps<Data>) => <Ready {...props} />

/** A menu's two views: reading its title, and ready with its marks. */
type MenuViewProps<Data> = {
  [MENU_READS.reading]: ReadingMenuProps
  [MENU_READS.ready]: ReadyMenuProps<Data>
}

const MENU_VIEWS = {
  [MENU_READS.reading]: ReadingMenu,
  [MENU_READS.ready]: ReadyMenu,
} as const satisfies ViewsOf<MenuViewProps<unknown>>

type ReadMenuProps<Data> = MenuProps & {
  /** The read of the card's title. */
  read: UseQueryResult<Data>
  /** The marks, drawn once the read has answered. */
  Ready: ComponentType<ReadyProps<Data>>
}

/** A card's menu: the reading view until its title is read, then the marks. */
const ReadMenu = <Data,>({ read, Ready, ...menu }: ReadMenuProps<Data>) => {
  const view: ViewOf<MenuViewProps<Data>> =
    read.data === undefined
      ? {
          key: MENU_READS.reading,
          props: { title: menu.title, note: readingNoteOf(read.isError), onClose: menu.onClose },
        }
      : { key: MENU_READS.ready, props: { ...menu, data: read.data, Ready } }
  return <KeyedView<MenuViewProps<Data>> view={view} views={MENU_VIEWS} />
}

/**
 * A show's or a season's marks: Watched over every episode under it, Favourite where the server
 * says it can be one, and for a show Binge, faint while three other shows fill the list.
 */
const ItemOptions = ({ title, session, data, onClose }: ReadyProps<ItemDetails>) => {
  const marks = useItemMarks({ session, details: data })
  const options: CardMenuOption[] = [
    watchedOptionOf(marks.watched),
    ...(marks.favourite === null ? [] : [favouriteOptionOf(marks.favourite)]),
    ...(marks.binge === null ? [] : [bingeOptionOf(marks.binge)]),
  ]
  return <CardMenuList note={null} onClose={onClose} options={options} title={title} />
}

type ItemMenuProps = MenuProps & { itemId: number }

/** The menu over a show or a season: its page is read for how much is watched and its marks. */
const ItemMenu = ({ itemId, ...menu }: ItemMenuProps) => (
  <ReadMenu {...menu} Ready={ItemOptions} read={useQuery(menu.session.queries.itemQuery(itemId))} />
)

/** A movie's or an episode's marks: Watched, and Favourite unless its library is locked, as its page offers them. */
const VideoOptions = ({ title, session, data, onClose }: ReadyProps<MediaItem>) => {
  const marks = useVideoMarks({ session, media: data })
  const options: CardMenuOption[] = [
    watchedOptionOf(marks.watched),
    ...(marks.favourite === null ? [] : [favouriteOptionOf(marks.favourite)]),
  ]
  return <CardMenuList note={null} onClose={onClose} options={options} title={title} />
}

type VideoMenuProps = MenuProps & { mediaId: number }

/** The menu over a movie or an episode: the video is read afresh for its marks as they are now. */
const VideoMenu = ({ mediaId, ...menu }: VideoMenuProps) => (
  <ReadMenu
    {...menu}
    Ready={VideoOptions}
    read={useQuery(menu.session.queries.mediaQuery(mediaId))}
  />
)

/** An album's one mark: Favourite. */
const AlbumOptions = ({ title, session, data, onClose }: ReadyProps<AlbumDetails>) => {
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: data.album.id })
  const options = [favouriteOptionOf({ isOn: data.isFavourite, onToggle: favourite.mutate })]
  return <CardMenuList note={null} onClose={onClose} options={options} title={title} />
}

type AlbumMenuProps = MenuProps & { albumId: number }

/** The menu over an album: its page is read for whether it is a favourite. */
const AlbumMenu = ({ albumId, ...menu }: AlbumMenuProps) => (
  <ReadMenu
    {...menu}
    Ready={AlbumOptions}
    read={useQuery(menu.session.queries.albumQuery(albumId))}
  />
)

type SubjectMenuViewProps = {
  [CARD_SUBJECTS.item]: ItemMenuProps
  [CARD_SUBJECTS.video]: VideoMenuProps
  [CARD_SUBJECTS.album]: AlbumMenuProps
}

const SUBJECT_MENUS = {
  [CARD_SUBJECTS.item]: ItemMenu,
  [CARD_SUBJECTS.video]: VideoMenu,
  [CARD_SUBJECTS.album]: AlbumMenu,
} as const satisfies ViewsOf<SubjectMenuViewProps>

type SubjectMenuViewOfProps = MenuProps & { subject: CardSubject }

/** The menu for what a card stands for, each kind handed its own id. */
const subjectMenuViewOf = ({
  subject,
  ...menu
}: SubjectMenuViewOfProps): ViewOf<SubjectMenuViewProps> => {
  switch (subject.kind) {
    case CARD_SUBJECTS.item:
      return { key: CARD_SUBJECTS.item, props: { ...menu, itemId: subject.itemId } }
    case CARD_SUBJECTS.video:
      return { key: CARD_SUBJECTS.video, props: { ...menu, mediaId: subject.mediaId } }
    case CARD_SUBJECTS.album:
      return { key: CARD_SUBJECTS.album, props: { ...menu, albumId: subject.albumId } }
    default: {
      const unknown: never = subject
      return unknown
    }
  }
}

type CardMenuProps = { title: string; subject: CardSubject; onClose: () => void }

/**
 * The menu a held select opens over a card on a TV: the marks the card's title takes, Watched,
 * Favourite and, for a show, Binge, each made through the same hooks its page uses, so a mark
 * shows on the page and in every list as the page's own would. Drawn only while it is open, so
 * a screen of cards reads nothing until one is held.
 */
export const CardMenu = ({ title, subject, onClose }: CardMenuProps) => {
  const session = useAppQueries()
  return (
    session !== null && (
      <KeyedView<SubjectMenuViewProps>
        view={subjectMenuViewOf({ subject, title, session, onClose })}
        views={SUBJECT_MENUS}
      />
    )
  )
}
