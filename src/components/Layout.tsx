import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { CheckSquare, BarChart2, Settings } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const mainTabs = [
  { to: '/dashboard', label: 'Today', Icon: CheckSquare },
  { to: '/insights', label: 'Insights', Icon: BarChart2 },
]

export default function Layout() {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar — icon rail that expands on hover */}
      <aside className="hidden lg:flex lg:flex-col group w-12 hover:w-40 overflow-hidden transition-all duration-200 border-r border-border bg-card px-2 py-6 gap-1 shrink-0">
        <div className="mb-6 px-1 flex items-center gap-2 overflow-hidden">
          <CheckSquare className="h-5 w-5 text-primary shrink-0" />
          <span className="text-primary font-bold text-base whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">HabitFlow</span>
        </div>
        {mainTabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 p-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 p-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Settings className="h-5 w-5 shrink-0" />
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top header */}
        <header className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-card shrink-0">
          <span className="text-primary font-bold text-base">HabitFlow</span>
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-20 lg:pb-6">
          <div className="max-w-2xl mx-auto px-4 py-4 lg:px-6 lg:py-6">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Mobile bottom tab bar — 2 tabs only */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card safe-bottom z-50">
        <div className="flex items-center justify-around h-16">
          {mainTabs.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 flex-1 h-16 justify-center transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
