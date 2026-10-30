import { themeOf } from '@raven/core'
import { Logo } from '@/components/Logo/Logo'
import { useTheme } from '@/stores/theme'
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/LogoSection.module.scss'

const GROUNDS = { night: styles.groundNight, bark: styles.groundBark } as const

/** Every version of the mark, each on the ground it is drawn for. */
const MARKS = [
  {
    name: 'On dark',
    file: 'brand/raven-mark-on-dark.svg',
    alt: 'The mark on dark',
    ground: 'night',
    note: 'Bark on the night ground, for the dark themes.',
  },
  {
    name: 'On light',
    file: 'brand/raven-mark-on-light.svg',
    alt: 'The mark on light',
    ground: 'bark',
    note: 'The original ink and red, for light grounds.',
  },
  {
    name: 'One colour',
    file: 'brand/raven-mark-mono.svg',
    alt: 'The mark in one colour',
    ground: 'bark',
    note: 'The eye and the play button cut out, for where there is only one ink.',
  },
] as const satisfies ReadonlyArray<{
  name: string
  file: string
  alt: string
  ground: keyof typeof GROUNDS
  note: string
}>

/** The mark drawn for the other tone, for the lockup on bark, which is light on a dark theme. */
const INVERSE_MARKS = {
  dark: '/brand/raven-mark-on-light.svg',
  light: '/brand/raven-mark-on-dark.svg',
} as const

const COPY = DESIGN_COPY.logo

const FAVICON_SIZES = [16, 32, 48] as const

export const LogoSection = () => {
  const tone = useTheme((state) => themeOf(state.theme).tone)
  return (
    <DesignSection id={SECTION_IDS.logo} intro={COPY.intro}>
      <ul className={styles.marks}>
        {MARKS.map((mark) => (
          <li key={mark.file} className={styles.mark}>
            {/* Each mark keeps the ground it is drawn for, whatever theme the page wears. */}
            <div className={`${styles.ground} ${GROUNDS[mark.ground]}`} data-theme="verdigris">
              <img
                src={`/${mark.file}`}
                alt={mark.alt}
                width={646}
                height={705}
                className={styles.markImage}
              />
            </div>
            <div className={styles.markText}>
              <h3 className={styles.markName}>{mark.name}</h3>
              <code className={styles.file}>{mark.file}</code>
              <p className={styles.markNote}>{mark.note}</p>
            </div>
          </li>
        ))}
      </ul>
      <Specimen name={COPY.favicon} note={COPY.faviconNote}>
        <ul className={styles.favicons} data-theme="verdigris">
          {FAVICON_SIZES.map((size) => (
            <li key={size} className={styles.favicon}>
              <img src="/favicon.svg" alt={COPY.faviconAt(size)} width={size} height={size} />
              <span className={styles.size}>{size}</span>
            </li>
          ))}
          <li className={styles.favicon}>
            <img
              src="/apple-touch-icon.png"
              alt={COPY.homeIcon}
              width={60}
              height={60}
              className={styles.homeIcon}
            />
            <span className={styles.size}>{COPY.homeScreen}</span>
          </li>
        </ul>
      </Specimen>
      <Specimen name={COPY.lockup} note={COPY.lockupNote}>
        <div className={styles.lockups}>
          <div className={styles.lockup}>
            <Logo />
          </div>
          <div className={`${styles.lockup} ${styles.lockupInverse}`} aria-hidden="true">
            <img
              src={INVERSE_MARKS[tone]}
              alt=""
              width={646}
              height={705}
              className={styles.lockupMark}
            />
            <span className={styles.lockupWord}>{COPY.wordmark}</span>
          </div>
        </div>
      </Specimen>
    </DesignSection>
  )
}
