import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BUTTON_TONES, ButtonLink, Icon, type IconName } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import { ThemePicker } from '@/components/ThemePicker/ThemePicker'
import { AppPreview } from '@/pages/GetPage/AppPreview'
import { Downloads } from '@/pages/GetPage/Downloads'
import { LATEST_RELEASE, RELEASES, REPOSITORY } from '@/pages/GetPage/links'
import { PLATFORMS, detectSystem } from '@/pages/GetPage/platforms'
import { GET_COPY, GET_FEATURES_COPY } from '@/pages/GetPage/copy'
import styles from '@/pages/GetPage/GetPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { PAGE_PARAMS, APP_PATHS } from '@/lib/appPaths'

/** Where the downloads start, for the links that jump there. */
const DOWNLOADS_ID = 'download'

/** What raven does, a column each. */
const FEATURES = GET_FEATURES_COPY satisfies readonly {
  icon: IconName
  title: string
  text: string
}[]

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
  const system = detectSystem({
    query: params.get(PAGE_PARAMS.os),
    userAgent: window.navigator.userAgent,
  })
  const platform = PLATFORMS.find((each) => each.system === system)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <Logo />
        </span>
        <nav className={styles.nav} aria-label={GET_COPY.nav}>
          <a href={`#${DOWNLOADS_ID}`} className={styles.jump}>
            {COMMON_COPY.download}
          </a>
          <ButtonLink to={APP_PATHS.home} className={styles.openApp}>
            {GET_COPY.openWebApp}
          </ButtonLink>
        </nav>
        <ThemePicker className={styles.theme} />
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby={titleId}>
          <div className={styles.intro}>
            <h1 id={titleId} className={styles.headline}>
              {GET_COPY.headline}
            </h1>
            <p className={styles.pitch}>{GET_COPY.pitch}</p>
            <div className={styles.actions}>
              <ButtonLink to={LATEST_RELEASE} tone={BUTTON_TONES.primary} size="large">
                <Icon name="download" size="1.15em" />
                {platform ? GET_COPY.downloadFor(platform.name) : COMMON_COPY.download}
              </ButtonLink>
              <ButtonLink to={APP_PATHS.home} size="large" icon="globe">
                {GET_COPY.openInBrowser}
              </ButtonLink>
            </div>
            <p className={styles.needs}>
              {platform?.note ?? GET_COPY.everySystem}
              {GET_COPY.needsSeparator}{' '}
              <a href={`#${DOWNLOADS_ID}`}>
                {platform ? GET_COPY.otherPlatforms : GET_COPY.chooseYours}
              </a>
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
        <p className={styles.about}>{GET_COPY.about}</p>
        <ul className={styles.links}>
          <li>
            <a href={REPOSITORY}>{GET_COPY.source}</a>
          </li>
          <li>
            <a href={RELEASES}>{GET_COPY.releaseNotes}</a>
          </li>
          <li>
            <Link to={APP_PATHS.home}>{GET_COPY.openWebApp}</Link>
          </li>
        </ul>
      </footer>
    </div>
  )
}
