import { createContext, useContext } from 'react'
import type { ClosingBv } from '../data/types'

/** 4-niveau-rol-systeem:
 *
 *  - **viewer**   (lezer)              Alleen-lezen — geen edits.
 *  - **editor**   (financiële admin.)  Mag invullen: maandafsluiting, OHW
 *                                      Overzicht, FTE, kostenposten, en
 *                                      bestanden uploaden. Mag NIETS
 *                                      goedkeuren of definitief maken.
 *  - **approver** (CFO / business ctl) Editor-rechten + mag importbestanden
 *                                      goedkeuren, maand-afsluiting
 *                                      definitief maken, IC-tarieven
 *                                      controleren, LE-leerlus invullen.
 *  - **admin**    (beheer)             Approver-rechten + gebruikersbeheer
 *                                      en backups.
 *
 *  Hierarchie viewer < editor < approver < admin. Permissions stack — wie
 *  hoger zit krijgt automatisch alle rechten van lagere niveaus. */
export type Role = 'viewer' | 'editor' | 'approver' | 'admin'

/** Permissies-context. Default = view-only zodat een vergeten Provider
 *  nooit per ongeluk schrijfrechten geeft. */
export interface Permissions {
  /** True voor editor / approver / admin (de drie schrijf-rollen). */
  canEdit: boolean
  /** True voor approver / admin — mag definitief maken / goedkeuren. */
  canApprove: boolean
  /** True alleen voor admin — heeft toegang tot user-mgmt + backups. */
  isAdmin: boolean
  /** De effectieve rol van de huidige gebruiker. Nul = niet ingelogd. */
  role: Role | null
  /** Indien gezet: deze gebruiker is gebonden aan één specifieke BV en mag
   *  alleen data van die BV zien. null = geen restrictie. */
  lockedBv: ClosingBv | null
}

export const PermissionsContext = createContext<Permissions>({
  canEdit: false,
  canApprove: false,
  isAdmin: false,
  role: null,
  lockedBv: null,
})

export function usePermissions(): Permissions {
  return useContext(PermissionsContext)
}

/** True als de huidige user mag schrijven (editor en hoger). */
export function useCanEdit(): boolean {
  return usePermissions().canEdit
}

/** True als de huidige user mag goedkeuren / definitief maken. */
export function useCanApprove(): boolean {
  return usePermissions().canApprove
}

/** Korte helper: BV waar deze gebruiker aan vastzit (null = geen restrictie). */
export function useLockedBv(): ClosingBv | null {
  return usePermissions().lockedBv
}

/** Bepaal canEdit / canApprove / isAdmin uit de raw rol-string. Backward
 *  compat: oude profielen met role='user' worden naar 'viewer' gemapt. */
export function rolePermissions(role: Role | string | null | undefined): {
  canEdit: boolean
  canApprove: boolean
  isAdmin: boolean
  role: Role
} {
  const normalized = normalizeRole(role)
  return {
    canEdit:    normalized === 'editor' || normalized === 'approver' || normalized === 'admin',
    canApprove: normalized === 'approver' || normalized === 'admin',
    isAdmin:    normalized === 'admin',
    role:       normalized,
  }
}

/** Map willekeurige role-input op een geldig Role. Defaults naar 'viewer'. */
export function normalizeRole(role: Role | string | null | undefined): Role {
  if (role === 'admin' || role === 'approver' || role === 'editor' || role === 'viewer') return role
  // Legacy: 'user' uit de oude 2-rollen-implementatie was 'view-only'.
  if (role === 'user') return 'viewer'
  return 'viewer'
}

/** Nederlandse label voor UI. */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':    return 'Beheerder'
    case 'approver': return 'Controller'
    case 'editor':   return 'Financiële administratie'
    case 'viewer':   return 'Lezer'
  }
}
