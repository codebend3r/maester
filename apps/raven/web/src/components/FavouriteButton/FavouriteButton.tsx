import { Button } from '@raven/ui'
import styles from '@/components/FavouriteButton/FavouriteButton.module.scss'

type FavouriteButtonProps = {
  isFavourite: boolean
  onToggle: (favourite: boolean) => void
}

/** A page's heart: pressed for a favourite, and pressing it marks or unmarks one. */
export const FavouriteButton = ({ isFavourite, onToggle }: FavouriteButtonProps) => (
  <Button
    icon="heart"
    aria-label="Favourite"
    aria-pressed={isFavourite}
    className={styles.favourite}
    onClick={() => onToggle(!isFavourite)}
  />
)
