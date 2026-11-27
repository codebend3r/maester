import { DETAIL_COPY, WREN_ICONS } from '@raven/wren'
import type { ComponentType, ReactNode } from 'react'
import { DetailAction } from '@/components/DetailAction/DetailAction'
import { Nothing } from '@/components/Nothing/Nothing'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import type { Cover } from '@/music/useCovers'
import { WREN_ROUTES } from '@/routes'
import { BackButton } from '@/screens/detail/BackButton'
import { useGoBack } from '@/shell/useGoBack'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { COLORS, RADII } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { BackLink } from '@/ui/BackLink/BackLink'
import { IconButton } from '@/ui/IconButton/IconButton'
import styles from '@/screens/detail/CollectionHead.module.scss'

type MoreActionProps = { onMore: () => void }

/** The wide layout's More, among the head's actions; the narrow one's sits in its nav bar instead. */
function WideMore({ onMore }: MoreActionProps) {
  return <DetailAction icon={WREN_ICONS.more} label={DETAIL_COPY.more} onPress={onMore} />
}

const MORE_ACTIONS = {
  [FORM_FACTORS.phone]: Nothing,
  [FORM_FACTORS.tablet]: WideMore,
} as const satisfies Record<FormFactor, ComponentType<MoreActionProps>>

type HeadTopProps = { onMore: () => void }

/** The narrow layout's nav bar: back, and More at its end. */
function NarrowTop({ onMore }: HeadTopProps) {
  return (
    <nav className={styles.nav}>
      <BackButton />
      <IconButton
        color={COLORS.text}
        icon={WREN_ICONS.more}
        label={DETAIL_COPY.more}
        onPress={onMore}
      />
    </nav>
  )
}

/** The wide layout's "< Back" in red above the cover; its More sits with the actions. */
function WideTop() {
  const goBack = useGoBack({ fallback: WREN_ROUTES.library })
  return <BackLink onPress={goBack} />
}

const HEAD_TOPS = {
  [FORM_FACTORS.phone]: NarrowTop,
  [FORM_FACTORS.tablet]: WideTop,
} as const satisfies Record<FormFactor, ComponentType<HeadTopProps>>

type CollectionHeadProps = {
  cover: Cover | null
  title: string
  /** The album's artists as links, or nothing for a playlist. */
  byline?: ReactNode
  /** "Pop · 2014 · 20 songs · 1 hr 24 min". */
  meta: string
  onPlay: () => void
  onShuffle: () => void
  /** Whether there is anything to play: an empty playlist shows no Play or Shuffle. */
  canPlay?: boolean
  /** Opens the page's More sheet. */
  onMore: () => void
  /** Like, Queue. */
  actions: ReactNode
}

/**
 * An album's or a playlist's head: its cover with a soft shadow, its title in Young Serif, its
 * artists and facts, Play and Shuffle at equal width, and its actions under them. Under `48rem`
 * it is centred under its nav bar; from there it is a column under "< Back", More beside the
 * actions.
 */
export function CollectionHead({
  cover,
  title,
  byline,
  meta,
  onPlay,
  onShuffle,
  canPlay = true,
  onMore,
  actions,
}: CollectionHeadProps) {
  const formFactor = useFormFactor()
  const MoreAction = MORE_ACTIONS[formFactor]
  const Top = HEAD_TOPS[formFactor]
  return (
    <header className={styles.head}>
      <Top onMore={onMore} />
      <div className={styles.body}>
        <span className={styles.cover}>
          <AlbumArt cover={cover} isRaised radius={RADII.md} />
        </span>
        <h1 className={styles.title}>{title}</h1>
        {byline}
        {meta !== '' && <p className={styles.meta}>{meta}</p>}
        {canPlay && (
          <div className={styles.play}>
            <PlayButtons onPlay={onPlay} onShuffle={onShuffle} />
          </div>
        )}
        <div className={styles.actions}>
          {actions}
          <MoreAction onMore={onMore} />
        </div>
      </div>
    </header>
  )
}
