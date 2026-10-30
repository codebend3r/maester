import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import { TitleArt } from '@/layouts/TitleArt'

const NAME = 'American Assassin (2017)'

describe('TitleArt', () => {
  it('says its name from the view round the art, so Android never lets the remote focus the art', async () => {
    await render(
      <TitleArt
        height={60}
        logo={{ uri: 'https://nas.example/api/media/1/logo', headers: {} }}
        maxWidth={300}
        name={NAME}
        textStyle={{}}
      />,
    )
    const labelled = screen.getByRole('image', { name: NAME })
    expect(labelled.type).toBe('View')
    expect(labelled.children).toHaveLength(1)
    const [art] = labelled.children
    expect(typeof art === 'string' ? null : (art?.props.accessible ?? null)).toBeNull()
  })
})
