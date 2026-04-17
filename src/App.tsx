import { useState, useEffect } from 'react'
import type { TabId, GlobalFilter } from './data/types'
import { useNavStore } from './store/useNavStore'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { DashboardTab } from './components/dashboard/DashboardTab'
import { HoursTab } from './components/hours/HoursTab'
import { FinancialsTab } from './components/financials/FinancialsTab'
import { OhwTab } from './components/ohw/OhwTab'
import { PlTab } from './components/pl/PlTab'
import { BudgetTab } from './components/budget/BudgetTab'
import { MaandTab } from './components/maand/MaandTab'
import { Toast } from './components/common/Toast'
import { AiChat } from './components/dashboard/AiChat'
import { useOhwState } from './hooks/useOhwState'
import { useToast } from './hooks/useToast'

const DEFAULT_FILTER: GlobalFilter = { year: '2026', bv: 'all' }

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')
  const [filter, setFilter] = useState<GlobalFilter>(DEFAULT_FILTER)

  const { data2025, data2026, updateEntity } = useOhwState()
  const { toasts, showToast } = useToast()
  const navPending = useNavStore(s => s.pending)

  // Reageer op navigatie-verzoeken vanuit andere componenten (bijv. OHW → klik getal → ga naar import)
  useEffect(() => {
    if (navPending?.tab === 'maand') {
      setTab('maand')
    }
  }, [navPending])

  const onFilterChange = (patch: Partial<GlobalFilter>) =>
    setFilter(prev => ({ ...prev, ...patch }))

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
        {tab === 'pl'     && <PlTab filter={filter} />}
        {tab === 'budget' && <BudgetTab filter={filter} />}
        {tab === 'maand'  && <MaandTab filter={filter} />}
      </div>
      <Toast toasts={toasts} />
      <AiChat />
    </>
  )
}
