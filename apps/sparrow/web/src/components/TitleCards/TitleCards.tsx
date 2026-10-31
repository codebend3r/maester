import { Fragment } from 'react'
import styles from '@/components/TitleCards/TitleCards.module.scss'
import { TITLE_CARD_COPY, TITLE_CARDS_COPY } from '@/components/TitleCards/copy'
import type { TitleCard } from '@/lib/events'

type CardProps = { card: TitleCard }

/** One title: its name, then its year and a link to each copy. */
const Card = ({ card }: CardProps) => (
  <li className={styles.card}>
    <p className={styles.name}>{card.title}</p>
    <p className={styles.meta}>
      {card.year != null && <span>{card.year}</span>}
      {card.links.map((link, index) => (
        <Fragment key={link.url}>
          {(card.year != null || index > 0) && TITLE_CARD_COPY.separator}
          <a
            className={styles.link}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={TITLE_CARD_COPY.open({ title: card.title, copy: link.label })}
          >
            {link.label}
          </a>
        </Fragment>
      ))}
    </p>
  </li>
)

type TitleCardsProps = { cards: TitleCard[] }

/** The titles a reply's tools found, each shown once. */
export const TitleCards = ({ cards }: TitleCardsProps) => (
  <ul className={styles.cards} aria-label={TITLE_CARDS_COPY.label}>
    {cards.map((card) => (
      <Card key={card.key} card={card} />
    ))}
  </ul>
)
