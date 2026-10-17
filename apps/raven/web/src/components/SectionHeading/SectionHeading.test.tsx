import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'

describe('SectionHeading', () => {
  it('heads a section with its title and what sits beside it', () => {
    render(
      <section aria-labelledby="acting">
        <SectionHeading id="acting" aside="6 titles">
          Acting
        </SectionHeading>
      </section>,
    )
    expect(screen.getByRole('region', { name: 'Acting' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Acting' })).toBeInTheDocument()
    expect(screen.getByText('6 titles')).toBeInTheDocument()
  })
})
