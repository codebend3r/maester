import type { Rating, SlideshowMotion } from '@raven/core'
import { Fragment, type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@raven/ui'
import { type BackFallback, BackButton } from '@/components/BackButton/BackButton'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import { RatingPanel } from '@/components/RatingPanel/RatingPanel'
import { Bone } from '@/components/Skeleton/Skeleton'
import { Slideshow } from '@/components/Slideshow/Slideshow'
import type { watchLink } from '@/lib/itemLinks'
import styles from '@/components/ItemHeader/ItemHeader.module.scss'

/** What sits beside the title: a poster, an episode's still, or no picture at all. */
const PICTURE_SHAPES = { poster: 'poster', still: 'still', none: 'none' } as const

type PictureShape = (typeof PICTURE_SHAPES)[keyof typeof PICTURE_SHAPES]

/** The picture beside the title: a poster, or an episode's still, and the video it plays if it plays one. */
export type HeaderPicture = {
  shape: Exclude<PictureShape, typeof PICTURE_SHAPES.none>
  /** null for none yet: the title's first letter stands in. */
  url: string | null
  play?: ReturnType<typeof watchLink> & { label: string }
}

const HEADER_BACKDROP_TYPES = { picture: 'picture', slideshow: 'slideshow' } as const

/** What fades into the page behind the header: one picture, or several in turn, by their urls. */
export type HeaderBackdrop =
  | { type: typeof HEADER_BACKDROP_TYPES.picture; url: string }
  | {
      type: typeof HEADER_BACKDROP_TYPES.slideshow
      slides: readonly string[]
      motion: SlideshowMotion
    }

/** How far through the item the viewer is, 0 to 1, and the words for it: "2 of 3 watched", "23m left". */
export type HeaderProgress = { fraction: number; label: string }

/** A page's one picture behind its header, or none while it has none. */
export const pictureBackdrop = (url: string | null): HeaderBackdrop | null =>
  url == null ? null : { type: HEADER_BACKDROP_TYPES.picture, url }

const BackdropPicture = ({ backdrop }: { backdrop: HeaderBackdrop }) => {
  switch (backdrop.type) {
    case HEADER_BACKDROP_TYPES.picture:
      return <img className={styles.backdropPicture} src={backdrop.url} alt="" decoding="async" />
    case HEADER_BACKDROP_TYPES.slideshow:
      return (
        <Slideshow
          className={styles.backdropPicture}
          slides={backdrop.slides}
          motion={backdrop.motion}
        />
      )
    default: {
      const unknown: never = backdrop
      return unknown
    }
  }
}

/**
 * The picture behind the top of the page, faded into the night at its foot
 * and its left, where the title reads. Decorative, and it takes no clicks.
 */
const Backdrop = ({ backdrop }: { backdrop: HeaderBackdrop }) => (
  <div className={styles.backdrop} aria-hidden="true">
    <BackdropPicture backdrop={backdrop} />
  </div>
)

/** The content's columns for each kind of picture, or for none. */
const LAYOUTS = {
  poster: styles.content,
  still: `${styles.content} ${styles.withStill}`,
  none: `${styles.content} ${styles.noPicture}`,
} as const satisfies Record<PictureShape, string | undefined>

/** Each picture's frame: a poster's, or the wider one of a still. */
const PICTURES = {
  poster: styles.picture,
  still: `${styles.picture} ${styles.still}`,
} as const satisfies Record<HeaderPicture['shape'], string | undefined>

const Picture = ({ picture, title }: { picture: HeaderPicture; title: string }) => {
  const className = PICTURES[picture.shape]
  const content = picture.url ? (
    <img src={picture.url} alt="" decoding="async" />
  ) : (
    <span className={styles.letter} aria-hidden="true">
      {title.slice(0, 1)}
    </span>
  )
  if (!picture.play) return <div className={className}>{content}</div>
  const { label, ...link } = picture.play
  return (
    <Link {...link} className={`${className} ${styles.playable}`} aria-label={label}>
      {content}
      <span className={styles.playCorner} aria-hidden="true">
        <span className={styles.playMark}>
          <Icon name="play" size={22} />
        </span>
      </span>
    </Link>
  )
}

/**
 * The title as its logo, else in display type. A logo that fails to load
 * falls back to the words. The shadow falls from a wrapper, so it follows
 * the logo as drawn, recoloured or not.
 */
const TitleArt = ({ title, logo }: { title: string; logo: string | null }) => {
  const [hasFailed, setFailed] = useState(false)
  if (!logo || hasFailed) return title
  return (
    <span className={styles.logo}>
      <LogoImage
        className={styles.logoImage}
        src={logo}
        alt={title}
        onError={() => setFailed(true)}
      />
    </span>
  )
}

/** A thin line of how far through it is, its words beside it. */
const Progress = ({ progress }: { progress: HeaderProgress }) => (
  <p className={styles.progress}>
    <span className={styles.track} aria-hidden="true">
      <span
        className={styles.fill}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)}%` }}
      />
    </span>
    <span className={styles.progressLabel}>{progress.label}</span>
  </p>
)

/**
 * Parts of a line, a quiet dot between each, for a line of facts. A part
 * never breaks, and a line that wraps does so after a dot, so the next
 * starts flush. The line's own element sets its colour and size.
 */
export const Dotted = ({ parts }: { parts: readonly string[] }) =>
  parts.map((part, index) => (
    <Fragment key={part}>
      <span className={styles.part}>
        {part}
        {index < parts.length - 1 && (
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
        )}
      </span>
      <wbr />
    </Fragment>
  ))

const NO_EYEBROW: readonly string[] = []

/**
 * The top of a movie, show, season, episode or saga page: the way back in
 * a glass pill, the backdrop running behind it to the page's edges and
 * fading into the night, then the picture (a poster, or an episode's still,
 * with a play button on it when it plays) beside what the item is (a small
 * line over the title), the title in display type or as its logo, who made
 * it, the content rating and facts, the scores, how far through it the
 * viewer is, and the page's actions: `children` first (Play, favourite,
 * Watched), then `manage` (the editors and the menu) on a row of their own.
 * On a narrow screen the picture sits above the rest.
 */
export const ItemHeader = ({
  titleId,
  title,
  eyebrow = NO_EYEBROW,
  byline,
  contentRating,
  facts,
  ratings,
  picture,
  backdrop,
  logo = null,
  back,
  progress,
  children,
  manage,
}: {
  titleId: string
  title: string
  /** What the item is, above its title: "Show", a season's show, "Saga · 3 movies". */
  eyebrow?: readonly string[]
  /** "Directed by ...", "Created by ...". */
  byline: string | null
  contentRating: string | null
  facts: readonly string[]
  ratings: readonly Rating[]
  /** Left out for a page with no picture beside its title. */
  picture?: HeaderPicture
  backdrop: HeaderBackdrop | null
  /** The title as art, shown in its place: a movie's or show's logo. */
  logo?: string | null
  /** Where the page goes back to, over the backdrop's top corner. */
  back: BackFallback
  /** A line of how far through the item the viewer is, where the page has one. */
  progress?: HeaderProgress
  /**
   * The page's own actions: Play, favourite, Watched, Select. One whose label
   * cannot shrink marks itself `data-wide`, and the row makes room for it.
   */
  children?: ReactNode
  /** The actions that change the item: the editors, Fix match, the file's menu. */
  manage?: ReactNode
}) => (
  <header className={backdrop ? `${styles.hero} ${styles.withBackdrop}` : styles.hero}>
    {backdrop && <Backdrop backdrop={backdrop} />}
    <div className={styles.top}>
      <BackButton fallback={back} />
    </div>
    <div className={LAYOUTS[picture?.shape ?? PICTURE_SHAPES.none]}>
      {picture && <Picture picture={picture} title={title} />}
      <div className={styles.details}>
        {eyebrow.length > 0 && (
          <p className={styles.eyebrow}>
            <Dotted parts={eyebrow} />
          </p>
        )}
        <h1 id={titleId} className={styles.title}>
          <TitleArt key={logo ?? 'none'} title={title} logo={logo} />
        </h1>
        {byline && <p className={styles.byline}>{byline}</p>}
        {(contentRating != null || facts.length > 0) && (
          // Words that wrap as text does, so long genres take a second line on a phone.
          <p className={styles.facts}>
            {contentRating != null && (
              <>
                <span className={`${styles.part} ${styles.ratedPart}`}>
                  <span className={styles.rated}>
                    <span className="visually-hidden">Rated </span>
                    {contentRating}
                  </span>
                </span>
                <wbr />
              </>
            )}
            <Dotted parts={facts} />
          </p>
        )}
        <RatingPanel ratings={ratings} />
        {progress && <Progress progress={progress} />}
        {(!!children || !!manage) && (
          <div className={styles.actions}>
            {!!children && <div className={styles.group}>{children}</div>}
            {!!manage && <div className={`${styles.group} ${styles.manage}`}>{manage}</div>}
          </div>
        )}
      </div>
    </div>
  </header>
)

/**
 * The header while its item is on its way, laid out as the header itself:
 * the way back, its picture's place, then lines for the title, the byline
 * and facts, and the buttons.
 */
export const ItemHeaderSkeleton = ({ picture }: { picture: PictureShape }) => (
  <div className={styles.hero}>
    <div className={styles.top}>
      <Bone shape="button" />
    </div>
    <div className={LAYOUTS[picture]}>
      {picture !== PICTURE_SHAPES.none && (
        <span className={PICTURES[picture]}>
          <Bone shape="fill" />
        </span>
      )}
      <div className={styles.details}>
        <Bone shape="hero" width="most" />
        <Bone shape="text" width="half" />
        <Bone shape="small" width="short" />
        <span className={styles.group}>
          <Bone shape="button" />
          <Bone shape="button" />
        </span>
      </div>
    </div>
  </div>
)
