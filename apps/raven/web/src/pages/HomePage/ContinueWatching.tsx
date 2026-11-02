import {
  ITEM_IMAGE_KINDS,
  type MediaItem,
  type PosterEntry,
  cardLink,
  formatRuntime,
  mediaLabel,
  resolutionLabel,
  tileWords,
  watchLink,
} from '@raven/core'
import { ButtonLink, Icon } from '@raven/ui'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { CardLink } from '@/components/CardLink/CardLink'
import { useCardMenu } from '@/components/MediaMenu/useCardMenu'
import { ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { api } from '@/lib/api'
import { CONTINUE_WATCHING_PATH, HOME_CONTINUE_COUNT } from '@/lib/homeContinue'
import { itemQuery } from '@/lib/queries'
import { HOME_COPY } from '@/pages/HomePage/copy'
import styles from '@/pages/HomePage/ContinueWatching.module.scss'

/** "23m left", "1h 12m left"; null until the video's length is known. */
export const timeLeft = (media: MediaItem): string | null => {
  if (media.duration == null) return null
  const left = formatRuntime(media.duration - media.position)
  return left == null ? null : HOME_COPY.timeLeft(left)
}

type TileArtProps = { entry: PosterEntry }

/**
 * The art a tile wears: the backdrop of the show or film it belongs to, else
 * the frame grab the video already has, and the title's logo for the corner.
 * An episode's summary carries neither version, so the show's page is read
 * once through the query cache every page shares.
 */
const useTileArt = ({ entry: { media } }: TileArtProps) => {
  const artId = media.item?.show?.id ?? media.item?.id ?? null
  const { data } = useQuery({ ...itemQuery(artId ?? 0), enabled: artId !== null })
  const backdrop =
    data?.backdropVersion == null
      ? api.thumbnailUrl(media)
      : api.itemImageUrl({
          id: data.id,
          kind: ITEM_IMAGE_KINDS.backdrop,
          version: data.backdropVersion,
        })
  const logo =
    data?.logoVersion == null
      ? null
      : api.itemImageUrl({
          id: data.id,
          kind: ITEM_IMAGE_KINDS.logo,
          version: data.logoVersion,
        })
  return { backdrop, logo }
}

const TITLE_KINDS = { linked: 'linked', plain: 'plain' } as const
type TitleKind = (typeof TITLE_KINDS)[keyof typeof TITLE_KINDS]

type TileTitleProps = {
  page: ReturnType<typeof cardLink>
  title: string
  label: string
  /** The title's logo, which stands for its name where there is one. */
  logo: string | null
  onContextMenu: ReturnType<typeof useCardMenu>['onContextMenu']
}

type LinkedTitleProps = TileTitleProps

const LinkedTitle = ({ page, title, label, logo, onContextMenu }: LinkedTitleProps) => (
  <CardLink
    {...page}
    className={`${logo ? styles.logoSlot : styles.title} ${styles.link}`}
    aria-label={label}
    onContextMenu={onContextMenu}
  >
    {logo ? <img className={styles.logo} src={logo} alt="" decoding="async" /> : title}
  </CardLink>
)

type PlainTitleProps = TileTitleProps

const PlainTitle = ({ title, logo }: PlainTitleProps) =>
  logo ? (
    <span className={styles.logoSlot}>
      <img className={styles.logo} src={logo} alt={title} decoding="async" />
    </span>
  ) : (
    <span className={styles.title}>{title}</span>
  )

const TILE_TITLES = {
  [TITLE_KINDS.linked]: LinkedTitle,
  [TITLE_KINDS.plain]: PlainTitle,
} as const satisfies Record<TitleKind, ComponentType<TileTitleProps>>

type ContinueTileProps = { entry: PosterEntry }

/**
 * A video in progress as a wide tile on its show's or film's backdrop, the
 * title's logo in the top left corner, standing for its name, or the name
 * along the foot where it has no logo, then the episode or year, how far in it is and how long is left. The tile resumes
 * it; its name opens its page, where it has one. A right click opens the
 * card's menu.
 */
const ContinueTile = ({ entry }: ContinueTileProps) => {
  const { media } = entry
  const menu = useCardMenu({ media, matchType: null, beside: true })
  const label = mediaLabel(media)
  const { title, line } = tileWords(media)
  const left = timeLeft(media)
  const page = cardLink({ media, hasPages: true })
  const TileTitle = TILE_TITLES[page.state == null ? TITLE_KINDS.linked : TITLE_KINDS.plain]
  const resolution = resolutionLabel(media)
  const art = useTileArt({ entry })

  return (
    <li className={`${styles.tile} ${menu.hostClass}`}>
      <CardLink
        {...watchLink({ media })}
        className={styles.play}
        aria-label={HOME_COPY.playTitle(label)}
        onContextMenu={menu.onContextMenu}
      >
        <span className={styles.mark}>
          <Icon name="play" size={20} />
        </span>
      </CardLink>
      {art.logo && (
        <TileTitle
          page={page}
          title={title}
          label={label}
          logo={art.logo}
          onContextMenu={menu.onContextMenu}
        />
      )}
      <span className={styles.copy}>
        {!art.logo && (
          <TileTitle
            page={page}
            title={title}
            label={label}
            logo={null}
            onContextMenu={menu.onContextMenu}
          />
        )}
        {(line || resolution != null) && (
          <span className={styles.line}>
            {line && <span>{line}</span>}
            <ResolutionChip resolution={resolution} />
          </span>
        )}
        {left && (
          <span className={styles.progress}>
            <ResumeBar media={media} className={styles.bar} />
            <span className={styles.left}>{left}</span>
          </span>
        )}
      </span>
      <span className={styles.backdrop}>
        {art.backdrop && (
          <img
            className={styles.picture}
            src={art.backdrop}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </span>
      {menu.menu}
    </li>
  )
}

type ContinueTilesProps = { entries: readonly PosterEntry[]; id?: string }

/** The tiles, two across, one for each video in progress. */
export const ContinueTiles = ({ entries, id }: ContinueTilesProps) => (
  <ul id={id} className={styles.tiles}>
    {entries.map((entry) => (
      <ContinueTile key={entry.media.id} entry={entry} />
    ))}
  </ul>
)

type ContinueWatchingProps = { entries: PosterEntry[] }

/**
 * The first few videos in progress, the most recently watched first, as wide
 * tiles two across. How many is `HOME_CONTINUE_COUNT`; when there are more,
 * See all, with an arrow, goes to the page that lists every one.
 */
export const ContinueWatching = ({ entries }: ContinueWatchingProps) => {
  const id = useId()
  const hasMore = entries.length > HOME_CONTINUE_COUNT
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHeading
        id={id}
        aside={
          hasMore && (
            <ButtonLink
              tone="ghost"
              to={CONTINUE_WATCHING_PATH}
              aria-label={HOME_COPY.seeAllLabel(entries.length)}
            >
              {HOME_COPY.seeAll(entries.length)}
              <Icon name="next" size={16} />
            </ButtonLink>
          )
        }
      >
        {HOME_COPY.continueWatching}
      </SectionHeading>
      <ContinueTiles entries={entries.slice(0, HOME_CONTINUE_COUNT)} />
    </section>
  )
}
