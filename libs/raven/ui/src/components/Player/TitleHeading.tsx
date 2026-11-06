import { KeyedView, type ViewOf, type ViewsOf } from '@/components/KeyedView/KeyedView'
import type { TitleLogo } from '@/components/Player/PlayerServices'
import styles from '@/components/Player/Player.module.scss'

const HEADINGS = { words: 'words', art: 'art' } as const

type WordsHeadingProps = { label: string }

const WordsHeading = ({ label }: WordsHeadingProps) => <h1 className={styles.title}>{label}</h1>

type ArtHeadingProps = { logo: TitleLogo; onFail: (url: string) => void }

/** The title's art, with an episode's place and name beside it; its name is read in its place. */
const ArtHeading = ({ logo, onFail }: ArtHeadingProps) => (
  <h1 className={styles.titleArt}>
    <img
      className={styles.logo}
      src={logo.url}
      alt={logo.name}
      decoding="async"
      onError={() => onFail(logo.url)}
    />
    {logo.caption && <span className={styles.caption}>{logo.caption}</span>}
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
  label: string
  /** The art to draw, null where there is none or it failed to load. */
  logo: TitleLogo | null
  onFail: (url: string) => void
}

const headingOf = ({ label, logo, onFail }: TitleHeadingProps): ViewOf<HeadingProps> => {
  if (logo === null) return { key: HEADINGS.words, props: { label } }
  return { key: HEADINGS.art, props: { logo, onFail } }
}

/** The player's title: its art where the host has some, else its label in display type. */
export const TitleHeading = (props: TitleHeadingProps) => (
  <KeyedView<HeadingProps> views={HEADING_VIEWS} view={headingOf(props)} />
)
