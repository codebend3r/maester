import { Route, Routes } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage/HomePage'
import { LoginPage } from '@/pages/LoginPage/LoginPage'
import { LogoutPage } from '@/pages/LogoutPage/LogoutPage'

export const AppRoutes = () => (
  <Routes>
    <Route path="login" element={<LoginPage />} />
    <Route path="logout" element={<LogoutPage />} />
    <Route path="*" element={<HomePage />} />
  </Routes>
)
