import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ButtonLink, Icon, type IconName } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { AppPreview } from '@/pages/GetPage/AppPreview'
import { Downloads } from '@/pages/GetPage/Downloads'
import { LATEST_RELEASE, RELEASES, REPOSITORY } from '@/pages/GetPage/links'
import { PLATFORMS, detectSystem } from '@/pages/GetPage/platforms'
import styles from '@/pages/GetPage/GetPage.module.scss'

/** Where the downloads start, for the links that jump there. */
const DOWNLOADS_ID = 'download'

/** What raven does, a column each. */
const FEATURES = [
  {
    icon: 'play',
    title: 'Plays what you have',
    text: 'The original file plays as it is when your device can take it. When it cannot, your server converts it on the way.',
  },
  {
    icon: 'history',
    title: 'Picks up where you stopped',
    text: 'Continue watching, next episodes and history follow you from the desktop app to the browser and back.',
  },
  {
    icon: 'libraries',
    title: 'Kept in order',
    text: 'Films are matched to TMDB, grouped into sagas, and sorted the way you left them. Locked libraries stay behind a PIN.',
  },
] as const satisfies readonly { icon: IconName; title: string; text: string }[]

/**
 * `/get`, the whole screen: where raven is got. A glass header that stays
 * at the top with the logo, a jump to the downloads, the way into the web
 * app and the theme button. Then the pitch, with a download for the
 * viewer's system, read from the browser (or `?os=mac`, `windows` or
 * `linux`, to try each), and the way into the browser; a window of raven
 * in miniature; what it does, in three columns; the downloads for every
 * system and the web app; and links to the source, the releases and the
 * web app at the foot.
 */
export const GetPage = () => {
  const titleId = useId()
  const [params] = useSearchParams()
  const system = detectSystem({ query: params.get('os'), userAgent: window.navigator.userAgent })
  const platform = PLATFORMS.find((each) => each.system === system)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Logo />
        </span>
        <nav className={styles.nav} aria-label="Get raven">
          <a href={`#${DOWNLOADS_ID}`} className={styles.jump}>
            Download
          </a>
          <ButtonLink to="/" className={styles.openApp}>
            Open web app
          </ButtonLink>
        </nav>
        <ThemePicker className={styles.theme} />
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby={titleId}>
          <div className={styles.intro}>
            <h1 id={titleId} className={styles.headline}>
              Your films and shows, from your own server.
            </h1>
            <p className={styles.pitch}>
              raven plays the library you already keep. Install it on your computer, or open it in
              any browser pointed at your server.
            </p>
            <div className={styles.actions}>
              <ButtonLink to={LATEST_RELEASE} tone="primary" size="large">
                <Icon name="download" size="1.15em" />
                {platform ? `Download for ${platform.name}` : 'Download'}
              </ButtonLink>
              <ButtonLink to="/" size="large" icon="globe">
                Open in your browser
              </ButtonLink>
            </div>
            <p className={styles.needs}>
              {platform?.note ?? 'macOS, Windows and Linux'} ·{' '}
              <a href={`#${DOWNLOADS_ID}`}>{platform ? 'Other platforms' : 'Choose yours'}</a>
            </p>
          </div>
          <AppPreview />
        </section>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className={styles.feature}>
              <span className={styles.featureIcon}>
                <Icon name={feature.icon} size={24} />
              </span>
              <h2 className={styles.featureTitle}>{feature.title}</h2>
              <p className={styles.featureText}>{feature.text}</p>
            </li>
          ))}
        </ul>
        <Downloads id={DOWNLOADS_ID} system={system} />
      </main>
      <footer className={styles.footer}>
        <p className={styles.about}>raven · a self-hosted video library and player</p>
        <ul className={styles.links}>
          <li>
            <a href={REPOSITORY}>Source on GitHub</a>
          </li>
          <li>
            <a href={RELEASES}>Release notes</a>
          </li>
          <li>
            <Link to="/">Open web app</Link>
          </li>
        </ul>
      </footer>
    </div>
  )
}
