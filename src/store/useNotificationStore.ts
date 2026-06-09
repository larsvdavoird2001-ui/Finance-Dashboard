// Berichteninbox voor de role-based workflow tussen financiële administratie
// (editor) en controller / CFO (approver).
//
// Voorbeelden van events die hier doorheen lopen:
//   - editor uploadt een importbestand        → notificatie naar approvers
//     ("Factuurvolume Mar-26 staat klaar voor goedkeuring")
//   - editor vinkt IC-tarieven aan als klaar  → notificatie naar approvers
//   - kalender rolt naar nieuwe maand          → notificatie naar editors
//     ("Mei is begonnen — start de Maandafsluiting voor Apr-26")
//   - approver finaliseert een Maandafsluiting → notificatie naar editors
//     én approvers ("Mar-26 definitief afgesloten")
//
// Persistentie: Supabase (tabel `notifications`) + localStorage als cache.
// Door de gedeelde Supabase-tabel ziet elke gebruiker meteen dezelfde inbox —
// een melding van user A verschijnt via Supabase Realtime direct bij user B.
// `read_by` is een array van emails zodat per-user gelezen-status individueel
// blijft terwijl de melding zelf gedeeld is.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role } from '../lib/permissions'
import {
  fetchNotifications,
  upsertNotification,
  deleteNotification,
  deleteNotificationsByDedupe,
} from '../lib/db'

export type NotificationCategory =
  | 'import-pending'         // editor heeft import geüpload, wacht op approval
  | 'tariff-pending'         // IC-tarieven aangevinkt door editor, wacht op review
  | 'maand-start'            // nieuwe kalendermaand → start Maandafsluiting
  | 'maand-finalized'        // approver heeft maand definitief gemaakt
  | 'reflection-needed'      // er staan LE-leerlus-vragen open
  | 'general'                // algemeen / fallback

export type NotificationTab = 'maand' | 'budget' | 'budgets' | 'ohw' | 'dashboard' | 'hours'

export interface Notification {
  id: string
  category: NotificationCategory
  /** Voor welke rollen is deze notificatie zichtbaar? */
  audience: Role[]
  title: string
  body?: string
  /** Click → navigatie naar deze tab. Optioneel met month/section voor
   *  deep-link binnen die tab. */
  link?: { tab: NotificationTab; month?: string }
  /** ISO-timestamp — wanneer ontstaan. */
  createdAt: string
  /** Welke users hebben deze al gelezen? — opgeslagen als email-lijst. */
  readBy: string[]
  /** Optionele dedupe-key. Notificaties met dezelfde key worden niet
   *  dubbel toegevoegd (handig voor periodieke triggers zoals "maand
   *  is begonnen — start afsluiting Apr-26"). Een partial UNIQUE index in
   *  Postgres dwingt dit ook DB-side af. */
  dedupeKey?: string
}

interface NotificationStore {
  notifications: Notification[]
  loaded: boolean
  /** Laad uit Supabase + merge met lokale state (DB wint per id). */
  loadFromDb: () => Promise<void>
  /** Voeg een notificatie toe (of skip als dedupeKey al bestaat). */
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'readBy'> & {
    id?: string
    dedupeKey?: string
  }) => void
  /** Markeer als gelezen voor een specifieke user. */
  markRead: (id: string, email: string) => void
  /** Markeer alles als gelezen voor een user. */
  markAllRead: (email: string, audienceFilter?: Role) => void
  /** Verwijder een notificatie. */
  remove: (id: string) => void
  /** Verwijder alle notificaties met deze dedupe-key (bv. clear pending). */
  removeByDedupe: (dedupeKey: string) => void
  /** Notificaties zichtbaar voor een rol, gesorteerd op nieuwste eerst. */
  visibleFor: (role: Role | null) => Notification[]
  /** Alleen ongelezen notificaties voor (rol, email). */
  unreadFor: (role: Role | null, email: string | null) => Notification[]
}

function nextId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      notifications: [],
      loaded: false,

      loadFromDb: async () => {
        // Merge-load: lokale state als basis (voor offline-recovery), DB wint
        // per id zodat read_by-arrays van andere users binnenkomen. Notificaties
        // die alleen lokaal bestaan worden naar DB gepusht — beschermt tegen
        // verlies wanneer Supabase tijdens een vorige insert offline was.
        let dbRows: Notification[] = []
        try {
          dbRows = await fetchNotifications()
        } catch (e) {
          console.warn('[useNotificationStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().notifications
        const dbIds = new Set(dbRows.map(n => n.id))
        // dedupe_keys die de DB al kent. Een lokale notificatie met dezelfde
        // key maar een ánder id is een duplicaat (ontstaan in een andere
        // sessie/client). Die mogen we NIET tonen én NIET terugpushen: een
        // insert met nieuw id + bestaande dedupe_key schendt de
        // uniq_notifications_dedupe UNIQUE index → continue save-fouten elke
        // poll. We laten de DB-versie leidend zijn.
        const dbDedupeKeys = new Set(
          dbRows.filter(n => n.dedupeKey).map(n => n.dedupeKey),
        )
        const byId = new Map<string, Notification>()
        for (const n of dbRows) byId.set(n.id, n) // DB is leidend
        for (const n of local) {
          if (dbIds.has(n.id)) continue
          if (n.dedupeKey && dbDedupeKeys.has(n.dedupeKey)) continue // dedupe-duplicaat → drop lokaal
          byId.set(n.id, n)
        }
        const merged = Array.from(byId.values())
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 500)
        set({ notifications: merged, loaded: true })
        // Reconcile: push alleen lokale notificaties die de server noch op id
        // noch op dedupe_key kent. Zo herhaalt een mislukte insert zich niet.
        for (const n of local) {
          if (dbIds.has(n.id)) continue
          if (n.dedupeKey && dbDedupeKeys.has(n.dedupeKey)) continue
          upsertNotification(n)
        }
      },

      addNotification: (n) => {
        // Skip silent als dedupe-key al bestaat. Zo krijgen 'maand begonnen'-
        // triggers niet 30 keer dezelfde regel.
        if (n.dedupeKey && get().notifications.some(x => x.dedupeKey === n.dedupeKey)) return
        const fresh: Notification = {
          id: n.id ?? nextId(),
          category: n.category,
          audience: n.audience,
          title: n.title,
          body: n.body,
          link: n.link,
          createdAt: new Date().toISOString(),
          readBy: [],
          dedupeKey: n.dedupeKey,
        }
        set(s => ({ notifications: [fresh, ...s.notifications].slice(0, 500) }))
        // Sync naar Supabase (fire-and-forget). De partial UNIQUE op
        // dedupe_key vangt race-conditions tussen clients af.
        upsertNotification(fresh)
      },

      markRead: (id, email) => {
        const norm = email.trim().toLowerCase()
        let changed: Notification | null = null
        set(s => ({
          notifications: s.notifications.map(n => {
            if (n.id !== id || n.readBy.includes(norm)) return n
            const updated = { ...n, readBy: [...n.readBy, norm] }
            changed = updated
            return updated
          }),
        }))
        if (changed) upsertNotification(changed)
      },

      markAllRead: (email, audienceFilter) => {
        const norm = email.trim().toLowerCase()
        const toSync: Notification[] = []
        set(s => ({
          notifications: s.notifications.map(n => {
            const inAudience = audienceFilter ? n.audience.includes(audienceFilter) : true
            if (!inAudience) return n
            if (n.readBy.includes(norm)) return n
            const updated = { ...n, readBy: [...n.readBy, norm] }
            toSync.push(updated)
            return updated
          }),
        }))
        for (const n of toSync) upsertNotification(n)
      },

      remove: (id) => {
        set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }))
        deleteNotification(id)
      },

      removeByDedupe: (dedupeKey) => {
        set(s => ({ notifications: s.notifications.filter(n => n.dedupeKey !== dedupeKey) }))
        deleteNotificationsByDedupe(dedupeKey)
      },

      visibleFor: (role) => {
        if (!role) return []
        const ns = get().notifications
        return ns
          .filter(n => n.audience.includes(role))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      },

      unreadFor: (role, email) => {
        const norm = (email ?? '').trim().toLowerCase()
        return get().visibleFor(role).filter(n => !n.readBy.includes(norm))
      },
    }),
    {
      name: 'tpg-notifications',
      partialize: (s) => ({ notifications: s.notifications }) as unknown as NotificationStore,
    },
  ),
)

/* ─── Trigger helpers — aanroepen vanuit andere componenten ────────────── */

/** Aanroepen wanneer een editor een importbestand uploadt. Notificeert
 *  approvers + admins zodat zij weten dat er iets te beoordelen is. */
export function notifyImportPending(slotLabel: string, month: string, byEmail: string): void {
  useNotificationStore.getState().addNotification({
    category: 'import-pending',
    audience: ['approver', 'admin'],
    title: `📥 Import wacht op goedkeuring: ${slotLabel}`,
    body: `${byEmail} heeft het bestand voor ${slotLabel} (${month}) geüpload. Beoordeel en keur goed in de Maandafsluiting.`,
    link: { tab: 'maand', month },
    dedupeKey: `import-pending|${slotLabel}|${month}`,
  })
}

/** Aanroepen wanneer een approver een import goedkeurt. Wist de pending-
 *  notificatie zodat de inbox schoon blijft. */
export function clearImportPendingFor(slotLabel: string, month: string): void {
  useNotificationStore.getState().removeByDedupe(`import-pending|${slotLabel}|${month}`)
}

/** Aanroepen bij start van een nieuwe kalendermaand om editors te triggeren
 *  dat ze de Maandafsluiting van de vorige maand kunnen starten. Dedupe op
 *  jaar+maand zodat het maar één keer per maand verschijnt. */
export function notifyMaandStart(targetMonth: string): void {
  useNotificationStore.getState().addNotification({
    category: 'maand-start',
    audience: ['editor', 'approver', 'admin'],
    title: `🗓 Tijd voor de Maandafsluiting van ${targetMonth}`,
    body: `De vorige maand is afgelopen. Start met importeren van bestanden, OHW-aanvulling en kostenposten in de Maandafsluiting.`,
    link: { tab: 'maand', month: targetMonth },
    dedupeKey: `maand-start|${targetMonth}`,
  })
}

/** Aanroepen wanneer een approver de maand definitief maakt. */
export function notifyMaandFinalized(month: string, byEmail: string): void {
  // Wist eerst de openstaande start-melding voor deze maand zodat hij niet
  // blijft hangen.
  useNotificationStore.getState().removeByDedupe(`maand-start|${month}`)
  useNotificationStore.getState().addNotification({
    category: 'maand-finalized',
    audience: ['editor', 'approver', 'admin'],
    title: `✅ ${month} definitief afgesloten`,
    body: `${byEmail} heeft ${month} definitief gemaakt. Beoordeel de afwijkingen in de LE-leerlus (Budget vs Actuals).`,
    link: { tab: 'budget', month },
    dedupeKey: `maand-finalized|${month}`,
  })
}

/** Aanroepen wanneer er nieuwe LE-leerlus-vragen klaarstaan voor een
 *  approver. Dedupe per maand zodat één maand één bericht oplevert. */
export function notifyReflectionNeeded(month: string, openCount: number): void {
  if (openCount <= 0) return
  useNotificationStore.getState().addNotification({
    category: 'reflection-needed',
    audience: ['approver', 'admin'],
    title: `🔁 ${openCount} LE-leerlus-${openCount === 1 ? 'vraag' : 'vragen'} voor ${month}`,
    body: `Beantwoord de vragen in Budget vs Actuals zodat de LE-engine van volgende maand er rekening mee houdt.`,
    link: { tab: 'budget', month },
    dedupeKey: `reflection-needed|${month}`,
  })
}
