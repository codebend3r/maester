import { useId } from 'react'
import { BINGE_LIMIT, type ItemSummary } from '@raven/core'
import { BUTTON_TONES, Button } from '@raven/ui'
import { BINGE_COPY } from '@/lib/binge'
import { useBingeProfile, useDismissBingeTip, useSetBinge } from '@/lib/useBinge'
import styles from '@/components/BingeButton/BingeButton.module.scss'
import { STORE_KEYS } from '@/stores/storage'

type BingeButtonProps = { item: Pick<ItemSummary, 'id' | 'type'> }

export const BingeButton = ({ item }: BingeButtonProps) => {
  const tipId = useId()
  const { ids, hasSeenTip } = useBingeProfile()
  const setBinge = useSetBinge()
  const dismissTip = useDismissBingeTip()
  const isBinging = ids.includes(item.id)
  const isFull = !isBinging && ids.length >= BINGE_LIMIT
  const hasSeenTipInCache = window.localStorage.getItem(STORE_KEYS.bingeTip) === 'true'
  const shouldShowTip = !hasSeenTip && !hasSeenTipInCache && !isBinging
  return (
    <span className={styles.control} data-wide>
      <Button
        icon="popcorn"
        aria-pressed={isBinging}
        aria-disabled={isFull}
        aria-describedby={shouldShowTip ? tipId : undefined}
        title={isFull ? BINGE_COPY.limit : undefined}
        className={shouldShowTip ? styles.highlight : undefined}
        onClick={() => {
          if (!isFull) {
            window.localStorage.setItem(STORE_KEYS.bingeTip, 'true')
            setBinge.mutate({ id: item.id, binge: !isBinging })
          }
        }}
      >
        {isBinging ? BINGE_COPY.binging : BINGE_COPY.add}
      </Button>
      {shouldShowTip && !isFull && (
        <span className={styles.tip} role="note">
          <span id={tipId}>{BINGE_COPY.tip}</span>
          <Button
            tone={BUTTON_TONES.ghost}
            onClick={() => {
              window.localStorage.setItem(STORE_KEYS.bingeTip, 'true')
              dismissTip.mutate()
            }}
          >
            {BINGE_COPY.dismiss}
          </Button>
        </span>
      )}
    </span>
  )
}
