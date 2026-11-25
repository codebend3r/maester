import { describe, expect, it, mock } from 'bun:test'
import { KIT_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { SheetActions } from '@/ui/SheetActions/SheetActions'
import { ICONS } from '@/ui/WrenIcon/icons'

type RenderSheetProps = { isOpen?: boolean }

const renderSheet = ({ isOpen = true }: RenderSheetProps = {}) => {
  const onClose = mock()
  const onPlayNext = mock()
  const rendered = render(
    <BottomSheet
      head={{ title: 'Airbag', subtitle: 'Radiohead', cover: null }}
      isOpen={isOpen}
      onClose={onClose}
    >
      <SheetActions
        groups={[
          [
            { icon: ICONS.playNext, label: TRACK_MENU_COPY.playNext, onPress: onPlayNext },
            { icon: ICONS.queueAdd, label: TRACK_MENU_COPY.addToQueue, onPress: () => undefined },
          ],
          [],
          [{ icon: ICONS.album, label: TRACK_MENU_COPY.goToAlbum, onPress: () => undefined }],
        ]}
      />
    </BottomSheet>,
  )
  return { ...rendered, onClose, onPlayNext }
}

const sheet = () => screen.getByRole('dialog', { name: 'Airbag' })

describe('BottomSheet', () => {
  it('holds nothing while it is down', () => {
    renderSheet({ isOpen: false })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Airbag')).toBeNull()
  })

  it('is a dialog named for what it is about, with its actions in their groups', () => {
    renderSheet()

    expect(within(sheet()).getByRole('heading', { name: 'Airbag' })).toBeInTheDocument()
    expect(within(sheet()).getByText('Radiohead')).toBeInTheDocument()
    expect(within(sheet()).getAllByRole('list')).toHaveLength(2)
    expect(
      within(sheet())
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([TRACK_MENU_COPY.playNext, TRACK_MENU_COPY.addToQueue, TRACK_MENU_COPY.goToAlbum])
  })

  it('does what an action pressed asks', async () => {
    const { onPlayNext } = renderSheet()

    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))

    expect(onPlayNext).toHaveBeenCalledTimes(1)
  })

  it('asks to close on its close button and on a press on the scrim', async () => {
    const { onClose } = renderSheet()
    const [scrim, close] = screen.getAllByRole('button', { name: KIT_COPY.close })

    await userEvent.click(close!)
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(scrim!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('asks to close on Escape, and stays up until the screen says it is down', () => {
    const { onClose } = renderSheet()

    fireEvent(sheet(), new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sheet()).toBeInTheDocument()
  })

  it('goes once the screen says it is down', () => {
    const { rerender, onClose } = renderSheet()

    rerender(
      <BottomSheet head={{ title: 'Airbag' }} isOpen={false} onClose={onClose}>
        {null}
      </BottomSheet>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
