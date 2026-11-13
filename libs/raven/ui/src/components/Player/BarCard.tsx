import { KeyedView, type ViewOf, type ViewsOf } from '@/components/KeyedView/KeyedView'
import { STAGE_COPY } from '@/components/Player/copy'
import type { UpNext } from '@/components/Player/PlayerServices'
import { SkipButton } from '@/components/Player/SkipButton'
import { UpNextCard } from '@/components/Player/UpNextCard'
import type { useUpNext } from '@/components/Player/useUpNext'

type SkipAction = { label: string; run: () => void }

type SkipActionOfProps = {
  undo: (() => void) | null
  skipIntro: (() => void) | null
  skipCredits: (() => void) | null
}

/** What the one skip button offers now, if anything: Undo first, then the intro, then the credits. */
export const skipActionOf = ({
  undo,
  skipIntro,
  skipCredits,
}: SkipActionOfProps): SkipAction | null => {
  if (undo) return { label: STAGE_COPY.undoSkip, run: undo }
  if (skipIntro) return { label: STAGE_COPY.skipIntro, run: skipIntro }
  if (skipCredits) return { label: STAGE_COPY.skipCredits, run: skipCredits }
  return null
}

/** What sits above the timeline at the right: the up next card, else the skip button. */
const BAR_CARDS = { upNext: 'upNext', skip: 'skip' } as const

export type BarCard =
  | { kind: typeof BAR_CARDS.upNext; next: UpNext }
  | { kind: typeof BAR_CARDS.skip; action: SkipAction }

type BarCardKind = BarCard['kind']

type BarCardOfProps = {
  isCardShown: boolean
  next: UpNext | null
  skipAction: SkipAction | null
}

/** The up next card while it shows, otherwise the skip on offer, if any. */
export const barCardOf = ({ isCardShown, next, skipAction }: BarCardOfProps): BarCard | null => {
  if (isCardShown && next) return { kind: BAR_CARDS.upNext, next }
  if (skipAction) return { kind: BAR_CARDS.skip, action: skipAction }
  return null
}

type BarCardScreenProps<K extends BarCardKind> = {
  card: Extract<BarCard, { kind: K }>
  upNext: ReturnType<typeof useUpNext>
  focusSurface: () => void
}

type UpNextViewProps = BarCardScreenProps<typeof BAR_CARDS.upNext>

const UpNextView = ({ card, upNext, focusSurface }: UpNextViewProps) => (
  <UpNextCard
    next={card.next}
    countdown={upNext.countdown}
    secondsLeft={upNext.secondsLeft}
    hasSceneAfter={upNext.hasSceneAfter}
    onPlay={upNext.playNext}
    onDismiss={() => {
      upNext.dismiss()
      focusSurface()
    }}
  />
)

type SkipViewProps = BarCardScreenProps<typeof BAR_CARDS.skip>

const SkipView = ({ card, focusSurface }: SkipViewProps) => (
  <SkipButton
    label={card.action.label}
    onClick={() => {
      card.action.run()
      focusSurface()
    }}
  />
)

/** Each card kind's view props, or only `Keys`' for a builder generic over the kind. */
type BarCardViewsProps<Keys extends BarCardKind = BarCardKind> = {
  [K in Keys]: BarCardScreenProps<K>
}

const BAR_CARD_VIEWS = {
  [BAR_CARDS.upNext]: UpNextView,
  [BAR_CARDS.skip]: SkipView,
} as const satisfies ViewsOf<BarCardViewsProps>

type BarCardViewOfProps<K extends BarCardKind> = BarCardScreenProps<K> & { kind: K }

/** The view for the card's kind, so each view is handed its own kind of card. */
const barCardViewOf = <K extends BarCardKind>({
  kind,
  ...props
}: BarCardViewOfProps<K>): ViewOf<BarCardViewsProps<K>, K> => ({ key: kind, props })

type BarCardViewProps = {
  card: BarCard
  upNext: ReturnType<typeof useUpNext>
  focusSurface: () => void
}

/** What sits above the timeline at the right, for its kind. */
export const BarCardView = ({ card, upNext, focusSurface }: BarCardViewProps) => (
  <KeyedView<BarCardViewsProps>
    views={BAR_CARD_VIEWS}
    view={barCardViewOf({ kind: card.kind, card, upNext, focusSurface })}
  />
)
