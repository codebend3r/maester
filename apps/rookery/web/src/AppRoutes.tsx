import { Route, Routes } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage/HomePage'
import { LoginPage } from '@/pages/LoginPage/LoginPage'
import { ROUTES } from '@/lib/routes'
import { LogoutPage } from '@/pages/LogoutPage/LogoutPage'

export const AppRoutes = () => (
  <Routes>
    <Route path={ROUTES.login} element={<LoginPage />} />
    <Route path={ROUTES.logout} element={<LogoutPage />} />
    <Route path="*" element={<HomePage />} />
  </Routes>
)
