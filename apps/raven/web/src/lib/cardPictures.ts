/** How a card is pictured: by a poster, or by a frame grab of its file. */
export const CARD_PICTURES = { poster: 'poster', frame: 'frame' } as const

export type CardPicture = (typeof CARD_PICTURES)[keyof typeof CARD_PICTURES]

type CardPictureOfProps = { hasPosters: boolean }

/** A poster where the cards have one to wear, else a frame grab. */
export const cardPictureOf = ({ hasPosters }: CardPictureOfProps): CardPicture =>
  hasPosters ? CARD_PICTURES.poster : CARD_PICTURES.frame
