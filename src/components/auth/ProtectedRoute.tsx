import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { FullPageLoader } from '../ui/Feedback'
import type { UserRole } from '../../lib/types'

export function homePath(role: UserRole | null | undefined, mustChange = false): string {
  if (mustChange) return '/change-password'
  if (role === 'admin') return '/admin'
  if (role === 'student') return '/student'
  return '/login'
}

export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader label="Checking your session…" />
  if (!session || !profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (profile.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return <Outlet />
}

export function RequireRole({ role }: { role: UserRole }) {
  const { profile, loading } = useAuth()

  if (loading) return <FullPageLoader label="Checking your access…" />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) return <Navigate to={homePath(profile.role)} replace />

  return <Outlet />
}

export function HomeRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return <FullPageLoader label="Opening PWCI Self Assessment Tool…" />
  if (!session || !profile) return <Navigate to="/login" replace />
  return <Navigate to={homePath(profile.role, profile.must_change_password)} replace />
}
