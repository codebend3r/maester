import { type ComponentType, useState } from 'react'
import styles from '@/components/TitleCards/TitleCards.module.scss'
import { TITLE_CARD_COPY, TITLE_CARDS_COPY } from '@/components/TitleCards/copy'
import type { TitleCard } from '@/lib/events'

const named = (card: TitleCard) =>
  card.year == null
    ? card.title
    : TITLE_CARD_COPY.titleWithYear({ title: card.title, year: card.year })

const TITLE_FACES = { logo: 'logo', name: 'name' } as const

type TitleFace = (typeof TITLE_FACES)[keyof typeof TITLE_FACES]

type TitleFaceProps = { card: TitleCard; onLogoBroken: () => void }

type TitleLogoProps = TitleFaceProps

const TitleLogo = ({ card, onLogoBroken }: TitleLogoProps) => (
  <img
    className={styles.logo}
    src={card.logoUrl ?? undefined}
    alt={named(card)}
    loading="lazy"
    onError={onLogoBroken}
  />
)

type TitleNameProps = TitleFaceProps

const TitleName = ({ card }: TitleNameProps) => <p className={styles.name}>{named(card)}</p>

const TITLE_FACE_VIEWS = {
  [TITLE_FACES.logo]: TitleLogo,
  [TITLE_FACES.name]: TitleName,
} as const satisfies Record<TitleFace, ComponentType<TitleFaceProps>>

type CardProps = { card: TitleCard }

/** One title: its logo, or its name when it has none, and a link to each copy. */
const Card = ({ card }: CardProps) => {
  const [isLogoBroken, setLogoBroken] = useState(false)
  const Face =
    TITLE_FACE_VIEWS[card.logoUrl != null && !isLogoBroken ? TITLE_FACES.logo : TITLE_FACES.name]
  return (
    <li className={styles.card}>
      <Face card={card} onLogoBroken={() => setLogoBroken(true)} />
      {card.links.length > 0 && (
        <ul className={styles.links} aria-label={TITLE_CARD_COPY.open(named(card))}>
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

type TitleCardsProps = { cards: TitleCard[] }

/** The titles a reply's tools found, each shown once. */
export const TitleCards = ({ cards }: TitleCardsProps) => (
  <ul className={styles.cards} aria-label={TITLE_CARDS_COPY.label}>
    {cards.map((card) => (
      <Card key={card.key} card={card} />
    ))}
  </ul>
)
