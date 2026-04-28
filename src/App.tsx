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
import { SetPasswordPage } from './components/auth/SetPasswordPage'
import { UsersTab } from './components/auth/UsersTab'
import { useOhwState } from './hooks/useOhwState'
import { useToast } from './hooks/useToast'
import { useDbInit } from './hooks/useDbInit'
import { useRealtimeSync } from './hooks/useRealtimeSync'
import { useUserProfileGuard } from './hooks/useUserProfileGuard'
import { useDataRefresh } from './hooks/useDataRefresh'
import { useAuth, profileNeedsPassword } from './lib/auth'
import { PermissionsContext } from './lib/permissions'
import { onDbEvent } from './lib/dbEvents'
import { snapshotLocalStorage } from './lib/localBackup'
import { autoDownloadIfStale } from './lib/dataExport'
import { BackupsTab } from './components/common/BackupsTab'

const DEFAULT_FILTER: GlobalFilter = { year: '2026', bv: 'all' }

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')
  const [filter, setFilter] = useState<GlobalFilter>(DEFAULT_FILTER)
  // Lokale "skip wachtwoord-instellen"-flag, alleen voor deze sessie.
  const [skipSetPw, setSkipSetPw] = useState(false)
  // Tweede gate voor SetPasswordPage — direct doorgaan na succes.
  const [pwJustSet, setPwJustSet] = useState(false)
  // Reden van geforceerde uitlog (deactivatie / verwijdering door admin).
  const [revokedReason, setRevokedReason] = useState<string | null>(null)

  const auth = useAuth()
  const {
    user, loading: authLoading, disabled: authDisabled,
    profiles, isAdmin,
    signIn, signOut, sendMagicLink, sendPasswordReset, setPassword,
    inviteUser, setUserActive, setUserRole, removeUser, refreshProfiles,
  } = auth
  const { data2025, data2026, updateEntity } = useOhwState()
  const { toasts, showToast } = useToast()
  const { ready: dbReady, error: dbError } = useDbInit()
  const refreshAllData = useDataRefresh()
  const [refreshing, setRefreshing] = useState(false)
  const navPending = useNavStore(s => s.pending)
  const userEmailKey = user?.email ?? null

  // Eénmalige snapshot van localStorage op app-start — voor het geval data
  // verdwijnt door bugs of cache-clears. listBackups() in BackupPanel toont
  // de laatste 5 snapshots zodat de admin er altijd op terug kan vallen.
  useEffect(() => {
    snapshotLocalStorage(userEmailKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-download naar Downloads-map: alleen voor admins, eens per 24 uur,
  // alleen als er ECHT data in localStorage staat. Ultiem vangnet — ook als
  // browser data wist of Supabase ontoegankelijk is, heb je het bestand.
  useEffect(() => {
    if (!user || !isAdmin) return
    autoDownloadIfStale(userEmailKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin])

  // Realtime sync — actief zodra een user is ingelogd. Bij elke wijziging in
  // de gedeelde tabellen worden de stores opnieuw geladen.
  useRealtimeSync(!!user && !authDisabled)

  // Bewaak of de huidige user nog mag inloggen. Sign-out direct als admin
  // hem deactiveert of verwijdert.
  useUserProfileGuard({
    email: user?.email ?? null,
    enabled: !!user && !authDisabled,
    onRevoked: async (reason) => {
      console.warn('[guard] toegang ingetrokken:', reason)
      setRevokedReason(reason)
      await signOut()
    },
  })

  // Reageer op navigatie-verzoeken vanuit andere componenten
  useEffect(() => {
    if (navPending?.tab === 'maand') setTab('maand')
    else if (navPending?.tab === 'ohw') setTab('ohw')
  }, [navPending])

  // Non-admin op admin-only tabs → terug naar dashboard
  useEffect(() => {
    if ((tab === 'users' || tab === 'backups') && !isAdmin) setTab('dashboard')
  }, [tab, isAdmin])

  // Reset revoked-reason zodra een nieuwe user inlogt
  useEffect(() => {
    if (user) setRevokedReason(null)
  }, [user])

  // Forceer een verse data-load zodra een gebruiker inlogt of switcht.
  // We CLEAREN localStorage NIET meer — de merge-load in de stores zorgt al
  // dat de gebruiker zijn eigen lokale state niet kwijtraakt en Supabase
  // wint per (entity, maand, key) waar er een waarde is. Een simpele
  // refresh haalt de gedeelde state op zonder dat lokale edits sneuvelen.
  useEffect(() => {
    if (!userEmailKey) return
    localStorage.setItem('tpg-last-user', userEmailKey)
    refreshAllData().catch(e => console.warn('[refresh on login] failed:', e))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmailKey])

  // Toast bij save-fouten uit de DB-laag — anders verdwijnen ze in console.
  useEffect(() => {
    return onDbEvent(e => {
      if (e.type === 'save-error') {
        showToast(`⚠ Niet opgeslagen in ${e.table}: ${e.message}`, 'r')
      } else {
        showToast(`⚠ Kon ${e.table} niet laden: ${e.message}`, 'r')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshAllData()
    } finally {
      setTimeout(() => setRefreshing(false), 600)
    }
  }

  const onFilterChange = (patch: Partial<GlobalFilter>) =>
    setFilter(prev => ({ ...prev, ...patch }))

  // Auth loading
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg1)', color: 'var(--t2)', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--bd2)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Controleren van login...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Niet ingelogd → LoginPage (eventueel met revoked-banner)
  if (!authDisabled && !user) {
    return (
      <>
        {revokedReason && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'var(--bd-red)', color: 'var(--red)',
            padding: '10px 18px', fontSize: 12, fontWeight: 600,
            borderBottom: '1px solid var(--red)', textAlign: 'center',
          }}>
            ⛔ {revokedReason} Log opnieuw in als je opnieuw bent uitgenodigd.
          </div>
        )}
        <LoginPage
          onSignIn={signIn}
          onSendMagicLink={sendMagicLink}
          onSendPasswordReset={sendPasswordReset}
          loading={authLoading}
          disabled={authDisabled}
        />
      </>
    )
  }

  // Set-password prompt
  const needsPw = profileNeedsPassword(user?.email, profiles)
  if (!authDisabled && user && needsPw && !skipSetPw && !pwJustSet) {
    const handleSetPassword = async (newPw: string) => {
      const result = await setPassword(newPw)
      if (!result.error) setPwJustSet(true)
      return result
    }
    return (
      <SetPasswordPage
        email={user.email ?? ''}
        onSetPassword={handleSetPassword}
        onSkip={() => setSkipSetPw(true)}
      />
    )
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

  const currentProfile = profiles.find(p => p.email.toLowerCase() === (user?.email ?? '').toLowerCase())
  const canEdit = isAdmin

  return (
    <PermissionsContext.Provider value={{ canEdit, isAdmin }}>
      <Sidebar
        active={tab}
        onNav={setTab}
        userEmail={user?.email ?? null}
        isAdmin={isAdmin}
        userRole={currentProfile?.role}
        onSignOut={signOut}
      />
      <div className={`main${canEdit ? '' : ' app-readonly'}`}>
        {!canEdit && (
          <div className="readonly-banner">
            <span className="ic">👁</span>
            <span style={{ flex: 1 }}>Alleen-lezen modus — neem contact op met een admin om wijzigingen te laten doen.</span>
            <button
              data-rw="ok"
              onClick={handleManualRefresh}
              disabled={refreshing}
              style={{
                fontSize: 11, fontWeight: 600,
                background: 'transparent',
                border: '1px solid var(--amber)',
                color: 'var(--amber)',
                padding: '3px 10px', borderRadius: 5,
                cursor: refreshing ? 'not-allowed' : 'pointer',
                opacity: refreshing ? 0.5 : 1,
              }}
              title="Forceer een verse data-load uit de database"
            >
              {refreshing ? '⏳ bezig...' : '↻ Herlaad data'}
            </button>
          </div>
        )}
        <Topbar tab={tab} filter={filter} onFilterChange={onFilterChange} />

        {tab === 'dashboard'  && <DashboardTab filter={filter} onFilterChange={onFilterChange} onNav={(t) => setTab(t)} />}
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
        {tab === 'users'   && (
          <UsersTab
            currentEmail={user?.email ?? null}
            profiles={profiles}
            isAdmin={isAdmin}
            inviteUser={inviteUser}
            setUserActive={setUserActive}
            setUserRole={setUserRole}
            removeUser={removeUser}
            refreshProfiles={refreshProfiles}
          />
        )}
        {tab === 'backups' && <BackupsTab isAdmin={isAdmin} currentEmail={userEmailKey} />}
      </div>
      <Toast toasts={toasts} />
      <AiChat />
    </PermissionsContext.Provider>
  )
}
