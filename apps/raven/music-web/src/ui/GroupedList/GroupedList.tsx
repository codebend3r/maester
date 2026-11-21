import { Children, type ReactNode, isValidElement } from 'react'
import styles from '@/ui/GroupedList/GroupedList.module.scss'

/** A row's own key, which `Children.toArray` gives every element. */
const keyOf = (child: ReactNode): string =>
  isValidElement(child) ? String(child.key) : String(child)

type GroupedListProps = {
  /** The overline above the card: "Server", "Appearance". */
  heading?: string
  children: ReactNode
}

/** A card of rows, divided by hairlines, under an overline heading: Settings' groups. */
export function GroupedList({ heading, children }: GroupedListProps) {
  return (
    <section className={styles.group}>
      {heading !== undefined && <h2 className={styles.heading}>{heading}</h2>}
      <ul className={styles.card}>
        {Children.toArray(children).map((child) => (
          <li className={styles.item} key={keyOf(child)}>
            {child}
          </li>
        ))}
      </ul>
    </section>
  )
}
