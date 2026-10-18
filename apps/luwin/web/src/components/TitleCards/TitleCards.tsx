import { useState } from 'react'
import styles from '@/components/TitleCards/TitleCards.module.scss'
import type { TitleCard } from '@/lib/events'

const named = (card: TitleCard) => (card.year == null ? card.title : `${card.title} (${card.year})`)

/** One title: its logo, or its name when it has none, and a link to each copy. */
const Card = ({ card }: { card: TitleCard }) => {
  const [isLogoBroken, setLogoBroken] = useState(false)
  const showsLogo = card.logoUrl != null && !isLogoBroken
  return (
    <li className={styles.card}>
      {showsLogo && (
        <img
          className={styles.logo}
          src={card.logoUrl ?? undefined}
          alt={named(card)}
          loading="lazy"
          onError={() => setLogoBroken(true)}
        />
      )}
      {!showsLogo && <p className={styles.name}>{named(card)}</p>}
      {card.links.length > 0 && (
        <ul className={styles.links} aria-label={`Open ${named(card)}`}>
          {card.links.map((link) => (
            <li key={link.url}>
              <a className={styles.link} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** The titles a reply's tools found, each shown once. */
export const TitleCards = ({ cards }: { cards: TitleCard[] }) => (
  <ul className={styles.cards} aria-label="Titles">
    {cards.map((card) => (
      <Card key={card.key} card={card} />
    ))}
  </ul>
)
