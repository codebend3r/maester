import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/** Renders `ui` at `route` in an in-memory router, with `/login` marked so a redirect shows. */
export const renderAt = (ui: ReactNode, { route = '/' }: { route?: string } = {}) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  )
