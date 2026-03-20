import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { CheckSquare, BarChart2, Settings, Shield, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Today', Icon: CheckSquare },
  { to: '/analytics', label: 'Analytics', Icon: BarChart2 },
  { to: '/settings', label: 'Settings', Icon: Settings },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()

  const allNav = user?.is_god
    ? [...navItems, { to: '/admin', label: 'God Mode', Icon: Shield }]
    : navItems

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:border-r lg:border-border lg:bg-card px-3 py-6 gap-1">
        <div className="px-3 mb-6">
          <h1 className="text-xl font-bold text-primary">HabitFlow</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{user?.display_name}</p>
        </div>
        {allNav.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
        <div className="mt-auto">
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-20 lg:pb-6">
          <div className="max-w-2xl mx-auto px-4 py-4 lg:px-6 lg:py-6">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card safe-bottom z-50">
        <div className="flex items-center justify-around h-16">
          {allNav.map(({ to, label, Icon }) => {
            const isActive = location.pathname.startsWith(to)
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  'flex flex-col items-center gap-1 min-w-[48px] min-h-[48px] justify-center px-3 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </NavLink>
            )
          })}
          <button
            onClick={() => logout()}
            className="flex flex-col items-center gap-1 min-w-[48px] min-h-[48px] justify-center px-3 transition-colors text-muted-foreground"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium">Sign out</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
