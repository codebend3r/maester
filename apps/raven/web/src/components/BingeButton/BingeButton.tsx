import { useId } from 'react'
import { BINGE_LIMIT, type ItemSummary } from '@raven/core'
import { Button } from '@raven/ui'
import { BINGE_COPY } from '@/lib/binge'
import { useBingeProfile, useDismissBingeTip, useSetBinge } from '@/lib/useBinge'
import styles from '@/components/BingeButton/BingeButton.module.scss'

type BingeButtonProps = { item: Pick<ItemSummary, 'id' | 'type'> }

export const BingeButton = ({ item }: BingeButtonProps) => {
  const tipId = useId()
  const { ids, hasSeenTip } = useBingeProfile()
  const setBinge = useSetBinge()
  const dismissTip = useDismissBingeTip()
  const isBinging = ids.includes(item.id)
  const isFull = !isBinging && ids.length >= BINGE_LIMIT
  const shouldShowTip = !hasSeenTip && !isBinging
  return (
    <span className={styles.control} data-wide>
      <Button
        icon="popcorn"
        aria-pressed={isBinging}
        aria-disabled={isFull}
        aria-describedby={isFull || shouldShowTip ? tipId : undefined}
        className={shouldShowTip ? styles.highlight : undefined}
        onClick={() => {
          if (!isFull) setBinge.mutate({ id: item.id, binge: !isBinging })
        }}
      >
        {isBinging ? BINGE_COPY.binging : BINGE_COPY.add}
      </Button>
      {shouldShowTip && !isFull && (
        <span className={styles.tip} role="note">
          <span id={tipId}>{BINGE_COPY.tip}</span>
          <Button tone="ghost" onClick={() => dismissTip.mutate()}>
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
