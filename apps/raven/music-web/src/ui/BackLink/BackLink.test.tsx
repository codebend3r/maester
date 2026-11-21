import { describe, expect, it, mock } from 'bun:test'
import { KIT_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderKitWithRoutes } from '@/test/render'
import { BackLink } from '@/ui/BackLink/BackLink'

describe('BackLink', () => {
  it('reads a back link with nowhere named as Back', async () => {
    const onPress = mock()
    renderKitWithRoutes(<BackLink onPress={onPress} />)

    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.backAlone }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
