import { ButtonLink } from '@/components/Button/Button'
import styles from '@/pages/NotFoundPage/NotFoundPage.module.scss'

export const NotFoundPage = () => (
  <section className={styles.page}>
    <h1 className={styles.title}>Nothing lives at this address</h1>
    <p>The library or video may have been removed, or the link is incomplete.</p>
    <ButtonLink to="/" icon="back">
      Back to libraries
    </ButtonLink>
  </section>
)
