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
// Persistentie: localStorage (zustand persist) — multi-device sync via
// Supabase volgt later via een aparte `notifications` tabel.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role } from '../lib/permissions'

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
  /** Welke users hebben deze al gelezen? — opgeslagen als email-set. */
  readBy: string[]
  /** Optionele dedupe-key. Notificaties met dezelfde key worden niet
   *  dubbel toegevoegd (handig voor periodieke triggers zoals "maand
   *  is begonnen — start afsluiting Apr-26"). */
  dedupeKey?: string
}

interface NotificationStore {
  notifications: Notification[]
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

      addNotification: (n) => {
        // Skip silent als dedupe-key al bestaat (en niet al gelezen). Zo
        // krijgen 'maand begonnen'-triggers niet 30 keer dezelfde regel.
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
        set(s => ({ notifications: [fresh, ...s.notifications].slice(0, 200) }))
      },

      markRead: (id, email) => {
        const norm = email.trim().toLowerCase()
        set(s => ({
          notifications: s.notifications.map(n =>
            n.id === id && !n.readBy.includes(norm)
              ? { ...n, readBy: [...n.readBy, norm] }
              : n,
          ),
        }))
      },

      markAllRead: (email, audienceFilter) => {
        const norm = email.trim().toLowerCase()
        set(s => ({
          notifications: s.notifications.map(n => {
            const inAudience = audienceFilter ? n.audience.includes(audienceFilter) : true
            if (!inAudience) return n
            if (n.readBy.includes(norm)) return n
            return { ...n, readBy: [...n.readBy, norm] }
          }),
        }))
      },

      remove: (id) => set(s => ({ notifications: s.notifications.filter(n => n.id !== id) })),

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
  const dedupe = `import-pending|${slotLabel}|${month}`
  useNotificationStore.setState(s => ({
    notifications: s.notifications.filter(n => n.dedupeKey !== dedupe),
  }))
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
  const startDedupe = `maand-start|${month}`
  useNotificationStore.setState(s => ({
    notifications: s.notifications.filter(n => n.dedupeKey !== startDedupe),
  }))
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
