import { PAGE_PATHS } from '@rookery/core'
import { Route, Routes } from 'react-router-dom'
import { ANY_PATH } from '@/lib/routes'
import { HomePage } from '@/pages/HomePage/HomePage'
import { LoginPage } from '@/pages/LoginPage/LoginPage'
import { LogoutPage } from '@/pages/LogoutPage/LogoutPage'

export const AppRoutes = () => (
  <Routes>
    <Route path={PAGE_PATHS.login} element={<LoginPage />} />
    <Route path={PAGE_PATHS.logout} element={<LogoutPage />} />
    <Route path={ANY_PATH} element={<HomePage />} />
  </Routes>
)
