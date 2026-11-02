import { expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { artist } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { reported } from '@/test/viewport'

it('shows an artist photo when the server gave it a capability version', async () => {
  const { container } = renderWithProviders({
    ui: <ArtistList artists={[artist({ id: 7, photoVersion: 'photo-v1' })]} label="Artists" />,
  })
  await reported()
  expect(screen.getByRole('link', { name: 'Radiohead' })).toBeVisible()
  expect(container.querySelector('img')).toHaveAttribute('src', '/api/pictures/artists/7/photo-v1')
})
