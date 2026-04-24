import { useState, useEffect } from 'react'
import type { TabId, GlobalFilter } from './data/types'
import { useNavStore } from './store/useNavStore'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { DashboardTab } from './components/dashboard/DashboardTab'
import { HoursTab } from './components/hours/HoursTab'
import { OhwTab } from './components/ohw/OhwTab'
import { BudgetTab } from './components/budget/BudgetTab'
import { BudgetsTab } from './components/budget/BudgetsTab'
import { MaandTab } from './components/maand/MaandTab'
import { Toast } from './components/common/Toast'
import { AiChat } from './components/dashboard/AiChat'
import { LoginPage } from './components/auth/LoginPage'
import { useOhwState } from './hooks/useOhwState'
import { useToast } from './hooks/useToast'
import { useDbInit } from './hooks/useDbInit'
import { useAuth } from './lib/auth'

const DEFAULT_FILTER: GlobalFilter = { year: '2026', bv: 'all' }

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')
  const [filter, setFilter] = useState<GlobalFilter>(DEFAULT_FILTER)

  const { user, loading: authLoading, disabled: authDisabled, signIn, signUp, signOut } = useAuth()
  const { data2025, data2026, updateEntity } = useOhwState()
  const { toasts, showToast } = useToast()
  const { ready: dbReady, error: dbError } = useDbInit()
  const navPending = useNavStore(s => s.pending)

  // Reageer op navigatie-verzoeken vanuit andere componenten (bijv. OHW → klik getal → ga naar import)
  useEffect(() => {
    if (navPending?.tab === 'maand') {
      setTab('maand')
    } else if (navPending?.tab === 'ohw') {
      setTab('ohw')
    }
  }, [navPending])

  const onFilterChange = (patch: Partial<GlobalFilter>) =>
    setFilter(prev => ({ ...prev, ...patch }))

  // Auth loading state (check sessie bij app-start)
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg1)', color: 'var(--t2)', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--bd2)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Controleren van login...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Niet ingelogd én Supabase is geconfigureerd → toon login-pagina
  if (!authDisabled && !user) {
    return <LoginPage onSignIn={signIn} onSignUp={signUp} loading={authLoading} disabled={authDisabled} />
  }

  // Loading state terwijl Supabase data laadt
  if (!dbReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg1)', color: 'var(--t2)', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--bd2)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Laden vanuit database...</span>
        {dbError && <span style={{ fontSize: 11, color: 'var(--amber)' }}>⚠ {dbError} — lokale data wordt gebruikt</span>}
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <>
      <Sidebar active={tab} onNav={setTab} userEmail={user?.email ?? null} onSignOut={signOut} />
      <div className="main">
        <Topbar tab={tab} filter={filter} onFilterChange={onFilterChange} />

        {tab === 'dashboard'  && <DashboardTab filter={filter} onNav={(t) => setTab(t)} />}
        {tab === 'hours'      && <HoursTab filter={filter} />}
        {tab === 'ohw' && (
          <OhwTab
            data2025={data2025}
            data2026={data2026}
            onEntityChange={updateEntity}
            showToast={showToast}
          />
        )}
        {tab === 'budget'  && <BudgetTab filter={filter} onFilterChange={onFilterChange} />}
        {tab === 'budgets' && <BudgetsTab filter={filter} />}
        {tab === 'maand'   && <MaandTab filter={filter} />}
      </div>
      <Toast toasts={toasts} />
      <AiChat />
    </>
  )
}
