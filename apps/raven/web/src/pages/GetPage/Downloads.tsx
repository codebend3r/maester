import { type FormEvent, useId, useRef, useState } from 'react'
import { ButtonLink, Icon } from '@raven/ui'
import { LATEST_RELEASE, webAppAddress } from '@/pages/GetPage/links'
import { type OperatingSystem, PLATFORMS } from '@/pages/GetPage/platforms'
import styles from '@/pages/GetPage/Downloads.module.scss'

type PlatformCardProps = {
  platform: (typeof PLATFORMS)[number]
  isYours: boolean
}

/**
 * A system's card: its name, what it needs, and a download for each of its
 * files. The viewer's own system is outlined and marked, and its first file
 * wears the accent.
 */
const PlatformCard = ({ platform, isYours }: PlatformCardProps) => {
  const nameId = useId()
  return (
    <article
      className={isYours ? `${styles.card} ${styles.yours}` : styles.card}
      aria-labelledby={nameId}
    >
      <header className={styles.head}>
        <h3 id={nameId} className={styles.name}>
          {platform.name}
        </h3>
        <p className={styles.needs}>{platform.needs}</p>
        {isYours && <p className={styles.badge}>Your system</p>}
      </header>
      <ul className={styles.files}>
        {platform.files.map((file, index) => (
          <li key={file.label} className={styles.fileItem}>
            <ButtonLink
              to={LATEST_RELEASE}
              tone={isYours && index === 0 ? 'primary' : 'quiet'}
              className={styles.file}
            >
              <Icon name="download" size={18} />
              <span className={styles.fileLabel}>
                <span className="visually-hidden">{platform.name}, </span>
                {file.label}
              </span>
              <span className={styles.fileKind}>{file.kind}</span>
            </ButtonLink>
          </li>
        ))}
      </ul>
    </article>
  )
}

/**
 * The web app, for a screen with nothing installed: the server's address,
 * this one to begin with, and Open web app to go to whatever is typed there.
 * Enter in the field goes too.
 */
const WebCard = () => {
  const ids = { name: useId(), server: useId() }
  const [server, setServer] = useState(window.location.origin)
  const open = useRef<HTMLAnchorElement>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    open.current?.click()
  }
  return (
    <article className={`${styles.card} ${styles.web}`} aria-labelledby={ids.name}>
      <header className={styles.head}>
        <h3 id={ids.name} className={styles.name}>
          In the browser
        </h3>
        <p className={styles.needs}>Nothing to install</p>
      </header>
      <form className={styles.server} onSubmit={submit}>
        <label htmlFor={ids.server} className={styles.serverLabel}>
          Your server
        </label>
        <input
          id={ids.server}
          className={styles.serverInput}
          type="url"
          name="server"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={server}
          onChange={(event) => setServer(event.target.value)}
        />
      </form>
      <ButtonLink
        ref={open}
        to={webAppAddress({ typed: server, origin: window.location.origin })}
        tone="primary"
        className={styles.open}
      >
        Open web app
      </ButtonLink>
    </article>
  )
}

type DownloadsProps = { id: string; system: OperatingSystem | undefined }

/**
 * Get raven: a card for each system the desktop app is offered on, the
 * viewer's own outlined, then the web app's. `id` is the section's, for the
 * links that jump to it.
 */
export const Downloads = ({ id, system }: DownloadsProps) => {
  const titleId = useId()
  return (
    <section id={id} className={styles.downloads} aria-labelledby={titleId}>
      <header className={styles.intro}>
        <h2 id={titleId} className={styles.title}>
          Get raven
        </h2>
        <p className={styles.lead}>
          The desktop app and the web app are the same raven. Pick whichever suits the screen.
        </p>
      </header>
      <ul className={styles.cards}>
        {PLATFORMS.map((platform) => (
          <li key={platform.system} className={styles.cardItem}>
            <PlatformCard platform={platform} isYours={platform.system === system} />
          </li>
        ))}
        <li className={styles.cardItem}>
          <WebCard />
        </li>
      </ul>
    </section>
  )
}
