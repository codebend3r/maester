import { PAGE_PATHS } from '@rookery/core'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ANY_PATH } from '@/lib/routes'

type RenderAtProps = { ui: ReactNode; route?: string }

/** Renders `ui` at `route` in an in-memory router, with `/login` marked so a redirect shows. */
export const renderAt = ({ ui, route = PAGE_PATHS.home }: RenderAtProps) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={PAGE_PATHS.login} element={<p>login page</p>} />
        <Route path={ANY_PATH} element={ui} />
      </Routes>
    </MemoryRouter>,
  )
