import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { KeyedView, type ViewOf, type ViewsOf } from '@/components/KeyedView/KeyedView'
import { STAGE_COPY } from '@/components/Player/copy'
import type { TitleLogo } from '@/components/Player/PlayerServices'
import styles from '@/components/Player/Player.module.scss'

const HEADINGS = { words: 'words', art: 'art' } as const

type HomeLinkProps = {
  name: string
  /** The title's page; null where it has none, and the heading links nowhere. */
  homeTo: string | null
  children: ReactNode
}

/** The heading's words or art, as a link to the title's page where it has one: an episode's show's, a film's own. */
const HomeLink = ({ name, homeTo, children }: HomeLinkProps) => (
  <>
    {homeTo != null && (
      <Link to={homeTo} className={styles.home} title={STAGE_COPY.goTo(name)}>
        {children}
      </Link>
    )}
    {homeTo == null && children}
  </>
)

type WordsHeadingProps = { name: string; homeTo: string | null }

const WordsHeading = ({ name, homeTo }: WordsHeadingProps) => (
  <h1 className={styles.title}>
    <HomeLink name={name} homeTo={homeTo}>
      {name}
    </HomeLink>
  </h1>
)

type ArtHeadingProps = { logo: TitleLogo; homeTo: string | null; onFail: (url: string) => void }

/** The title's art on a row of its own; its name is read in its place. */
const ArtHeading = ({ logo, homeTo, onFail }: ArtHeadingProps) => (
  <h1 className={styles.titleArt}>
    <HomeLink name={logo.name} homeTo={homeTo}>
      <img
        className={styles.logo}
        src={logo.url}
        alt={logo.name}
        decoding="async"
        onError={() => onFail(logo.url)}
      />
    </HomeLink>
  </h1>
)

type HeadingProps = {
  [HEADINGS.words]: WordsHeadingProps
  [HEADINGS.art]: ArtHeadingProps
}

const HEADING_VIEWS = {
  [HEADINGS.words]: WordsHeading,
  [HEADINGS.art]: ArtHeading,
} as const satisfies ViewsOf<HeadingProps>

type TitleHeadingProps = {
  /** The words the heading spells out without art: an episode's show's name, a film's. */
  name: string
  /** The art to draw, null where there is none or it failed to load. */
  logo: TitleLogo | null
  /** Where the heading links, null for nowhere. */
  homeTo: string | null
  onFail: (url: string) => void
}

const headingOf = ({ name, logo, homeTo, onFail }: TitleHeadingProps): ViewOf<HeadingProps> => {
  if (logo === null) return { key: HEADINGS.words, props: { name, homeTo } }
  return { key: HEADINGS.art, props: { logo, homeTo, onFail } }
}

/** The player's heading: the title's art where the host has some, else its name in display type. */
export const TitleHeading = (props: TitleHeadingProps) => (
  <KeyedView<HeadingProps> views={HEADING_VIEWS} view={headingOf(props)} />
)
