import { useId } from 'react'
import { type ItemSummary } from '@raven/core'
import { Button } from '@raven/ui'
import { BINGE_COPY, BINGE_LIMIT } from '@/lib/binge'
import { useBinge, useBingeProfile } from '@/stores/binge'
import styles from '@/components/BingeButton/BingeButton.module.scss'

type BingeButtonProps = { item: Pick<ItemSummary, 'id' | 'type'> }

export const BingeButton = ({ item }: BingeButtonProps) => {
  const tipId = useId()
  const { account, ids, hasSeenTip } = useBingeProfile()
  const toggle = useBinge((state) => state.toggle)
  const dismissTip = useBinge((state) => state.dismissTip)
  const isBinging = ids.includes(item.id)
  const isFull = !isBinging && ids.length >= BINGE_LIMIT
  const shouldShowTip = !hasSeenTip && !isBinging
  return (
    <span className={styles.control} data-wide>
      <Button
        icon="playback"
        aria-pressed={isBinging}
        aria-disabled={isFull}
        aria-describedby={isFull || shouldShowTip ? tipId : undefined}
        className={shouldShowTip ? styles.highlight : undefined}
        onClick={() => {
          if (!isFull) toggle({ account, item })
        }}
      >
        {isBinging ? BINGE_COPY.binging : BINGE_COPY.add}
      </Button>
      {shouldShowTip && !isFull && (
        <span className={styles.tip} role="note">
          <span id={tipId}>{BINGE_COPY.tip}</span>
          <Button tone="ghost" onClick={() => dismissTip(account)}>
            {BINGE_COPY.dismiss}
          </Button>
        </span>
      )}
      {isFull && (
        <output className={styles.tip} id={tipId}>
          {BINGE_COPY.limit}
        </output>
      )}
    </span>
  )
}
