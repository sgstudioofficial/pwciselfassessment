import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Send,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAuth } from '../../context/AuthContext'
import type { UserRole } from '../../lib/types'
import { Avatar } from '../ui/Misc'
import { Brand, BrandMark } from './Brand'

const navItems: {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
  roles: UserRole[]
}[] = [
  {
    to: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    roles: ['admin'],
  },
  { to: '/admin/students', label: 'Students', icon: Users, roles: ['admin'] },
  { to: '/admin/tests', label: 'Tests', icon: ClipboardList, roles: ['admin'] },
  {
    to: '/admin/assignments',
    label: 'Assignments',
    icon: Send,
    roles: ['admin'],
  },
  {
    to: '/admin/results',
    label: 'Results',
    icon: BarChart3,
    roles: ['admin', 'evaluator'],
  },
  { to: '/admin/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
]

export function AdminLayout() {
  const { profile, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isEvaluator = profile?.role === 'evaluator'
  const visibleNav = navItems.filter(
    (item) => profile != null && item.roles.includes(profile.role),
  )

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col bg-ink-900 text-slate-300 transition-transform duration-200 lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
      aria-label="Admin navigation"
    >
      <div className="flex h-20 items-center justify-between px-5">
        <Brand inverted />
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-4 mb-5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <ShieldCheck className="h-4 w-4 text-brand-300" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">
            {isEvaluator ? 'Results workspace' : 'Admin workspace'}
          </p>
          <p className="truncate text-xs text-slate-400">
            {isEvaluator ? 'Review and grade attempts' : 'Full assessment control'}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {visibleNav.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0',
                      isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300',
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {isActive ? (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                  ) : null}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
          <Avatar name={profile?.full_name ?? 'Admin'} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {profile?.full_name}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {profile?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-slate-600">
          PWCI · Assessment suite
        </p>
      </div>
    </aside>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      {sidebar}

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <BrandMark className="h-8 w-8 text-xs" />
              <span className="text-sm font-bold tracking-tight text-slate-900">
                PWCI
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {isEvaluator ? 'Evaluator' : 'Admin'}
            </span>
            <Avatar name={profile?.full_name ?? 'Admin'} size="sm" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
