import { Logo } from '@/components/Logo/Logo'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const GROUNDS = { night: styles.groundNight, bark: styles.groundBark } as const

/** Every version of the mark, each on the ground it is drawn for. */
const MARKS = [
  {
    name: 'On dark',
    file: 'brand/raven-mark-on-dark.svg',
    alt: 'The mark on dark',
    ground: 'night',
    note: 'Bark on the night ground, the one the app wears.',
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

const FAVICON_SIZES = [16, 32, 48] as const

export const LogoSection = () => (
  <DesignSection
    id="logo"
    title="Logo"
    intro="A raven with a play button for a wing. The files live in public/brand, with PNG copies of the two coloured marks and a 512 pixel tile for anywhere that takes no SVG."
  >
    <ul className={styles.marks}>
      {MARKS.map((mark) => (
        <li key={mark.file} className={styles.markCard}>
          <div className={`${styles.markGround} ${GROUNDS[mark.ground]}`}>
            <img
              src={`/${mark.file}`}
              alt={mark.alt}
              width={646}
              height={705}
              className={styles.markImage}
            />
          </div>
          <h3 className={styles.markName}>{mark.name}</h3>
          <code className={styles.tokenValue}>{mark.file}</code>
          <p className={styles.note}>{mark.note}</p>
        </li>
      ))}
    </ul>
    <Specimen
      name="Favicon"
      note="The mark on a night tile: favicon.svg where a browser takes it, favicon.ico at 16, 32 and 48 pixels where it doesn't, and a square apple-touch-icon.png for a home screen, which rounds its own corners."
    >
      <ul className={styles.favicons}>
        {FAVICON_SIZES.map((size) => (
          <li key={size} className={styles.favicon}>
            <img
              src="/favicon.svg"
              alt={`The favicon at ${size} pixels`}
              width={size}
              height={size}
            />
            <span>{size}</span>
          </li>
        ))}
        <li className={styles.favicon}>
          <img src="/apple-touch-icon.png" alt="The home screen icon" width={60} height={60} />
          <span>Home screen</span>
        </li>
      </ul>
    </Specimen>
    <Specimen name="Lockup" note="The mark beside the wordmark, as the header draws it.">
      <div className={styles.lockup}>
        <Logo />
      </div>
    </Specimen>
  </DesignSection>
)
