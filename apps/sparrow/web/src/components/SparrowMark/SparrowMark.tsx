import styles from '@/components/SparrowMark/SparrowMark.module.scss'

// The handoff's placeholder mark, until a final logo exists.
const SPARROW_PATH =
  'M27 9.5 23.6 8.6A5.2 5.2 0 0 0 14 10.8L13.4 14C8.6 14.4 4.8 18.4 3 25L9.4 22.6C12 25.6 16.4 26.2 20 24 24 21.4 25 16.4 24 12.4Z'

export const SPARROW_SIZES = { sm: 'sm', md: 'md', lg: 'lg' } as const

type SparrowSize = (typeof SPARROW_SIZES)[keyof typeof SPARROW_SIZES]

type SparrowMarkProps = { size: SparrowSize }

/** sparrow's glyph, in the colour of the text around it; decoration only. */
export const SparrowMark = ({ size }: SparrowMarkProps) => (
  <svg className={styles[size]} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d={SPARROW_PATH} fill="currentColor" />
  </svg>
)
