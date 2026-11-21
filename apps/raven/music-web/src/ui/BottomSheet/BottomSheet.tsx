import { classNames } from '@raven/ui/headless'
import { KIT_COPY } from '@raven/wren'
import { type ReactNode, useId } from 'react'
import type { Cover } from '@/music/useCovers'
import { COLORS, RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { ICON_BUTTON_VARIANTS, IconButton } from '@/ui/IconButton/IconButton'
import { useModalDialog } from '@/ui/useModalDialog'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/ui/BottomSheet/BottomSheet.module.scss'

/** What a sheet is about, at its top: a track's cover, its title and its line. */
type SheetHead = { title: string; subtitle?: string; cover?: Cover | null }

type BottomSheetProps = {
  /** Whether the sheet is up. */
  isOpen: boolean
  /** Asked by a press on the scrim, Escape, or Close. */
  onClose: () => void
  head: SheetHead
  children: ReactNode
}

type SheetBodyProps = Omit<BottomSheetProps, 'isOpen'> & { titleId: string }

function SheetBody({ onClose, head, titleId, children }: SheetBodyProps) {
  return (
    <>
      <button
        aria-label={KIT_COPY.close}
        className={styles.scrim}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section className={styles.sheet}>
        <span className={styles.grabber} />
        <header className={classNames([styles.header, head.cover !== undefined && styles.led])}>
          {head.cover !== undefined && (
            <AlbumArt cover={head.cover} radius={RADII.thumb} size={SIZES.sheetArt} />
          )}
          <div className={styles.headerText}>
            <h2 className={styles.title} id={titleId}>
              {head.title}
            </h2>
            {head.subtitle !== undefined && <p className={styles.subtitle}>{head.subtitle}</p>}
          </div>
          <IconButton
            color={COLORS.text2}
            icon={ICONS.close}
            label={KIT_COPY.close}
            onPress={onClose}
            size={SIZES.smallButton}
            variant={ICON_BUTTON_VARIANTS.filled}
          />
        </header>
        {children}
      </section>
    </>
  )
}

/**
 * A sheet over a scrim: a head naming what it is about, and its actions. Under `48rem` it rises
 * from the bottom, with a grabber, as the apps' does; from there it is a centred dialog. It goes
 * with a press on the scrim, Escape or Close; it has no Cancel. It rises in about a third of a
 * second, or at once for a listener who asked for less motion.
 */
export function BottomSheet({ isOpen, onClose, head, children }: BottomSheetProps) {
  const { ref, onCancel } = useModalDialog({ isOpen, onClose })
  const titleId = useId()
  return (
    <dialog aria-labelledby={titleId} className={styles.dialog} onCancel={onCancel} ref={ref}>
      {isOpen && (
        <SheetBody head={head} onClose={onClose} titleId={titleId}>
          {children}
        </SheetBody>
      )}
    </dialog>
  )
}
