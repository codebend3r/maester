import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

type RenderAtProps = { ui: ReactNode; route?: string }

/** Renders `ui` at `route` in an in-memory router, with `/login` marked so a redirect shows. */
export const renderAt = ({ ui, route = '/' }: RenderAtProps) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  )
