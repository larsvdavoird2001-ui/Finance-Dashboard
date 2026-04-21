import { useState, useEffect } from 'react'
import type { TabId, GlobalFilter } from './data/types'
import { useNavStore } from './store/useNavStore'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { DashboardTab } from './components/dashboard/DashboardTab'
import { HoursTab } from './components/hours/HoursTab'
import { FinancialsTab } from './components/financials/FinancialsTab'
import { OhwTab } from './components/ohw/OhwTab'
import { BudgetTab } from './components/budget/BudgetTab'
import { BudgetsTab } from './components/budget/BudgetsTab'
import { MaandTab } from './components/maand/MaandTab'
import { Toast } from './components/common/Toast'
import { AiChat } from './components/dashboard/AiChat'
import { useOhwState } from './hooks/useOhwState'
import { useToast } from './hooks/useToast'
import { useDbInit } from './hooks/useDbInit'

const DEFAULT_FILTER: GlobalFilter = { year: '2026', bv: 'all' }

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')
  const [filter, setFilter] = useState<GlobalFilter>(DEFAULT_FILTER)

  const { data2025, data2026, updateEntity } = useOhwState()
  const { toasts, showToast } = useToast()
  const { ready: dbReady, error: dbError } = useDbInit()
  const navPending = useNavStore(s => s.pending)

  // Reageer op navigatie-verzoeken vanuit andere componenten (bijv. OHW → klik getal → ga naar import)
  useEffect(() => {
    if (navPending?.tab === 'maand') {
      setTab('maand')
    }
  }, [navPending])

  const onFilterChange = (patch: Partial<GlobalFilter>) =>
    setFilter(prev => ({ ...prev, ...patch }))

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
      <Sidebar active={tab} onNav={setTab} />
      <div className="main">
        <Topbar tab={tab} filter={filter} onFilterChange={onFilterChange} />

        {tab === 'dashboard'  && <DashboardTab filter={filter} onNav={(t) => setTab(t)} />}
        {tab === 'hours'      && <HoursTab filter={filter} />}
        {tab === 'financials' && <FinancialsTab filter={filter} />}
        {tab === 'ohw' && (
          <OhwTab
            data2025={data2025}
            data2026={data2026}
            onEntityChange={updateEntity}
            showToast={showToast}
          />
        )}
        {tab === 'budget'  && <BudgetTab filter={filter} />}
        {tab === 'budgets' && <BudgetsTab filter={filter} />}
        {tab === 'maand'   && <MaandTab filter={filter} />}
      </div>
      <Toast toasts={toasts} />
      <AiChat />
    </>
  )
}
