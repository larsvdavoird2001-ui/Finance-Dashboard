import { createContext, useContext } from 'react'
import type { ClosingBv } from '../data/types'

/** Permissies-context. Default = view-only zodat een vergeten Provider
 *  nooit per ongeluk schrijfrechten geeft. */
export interface Permissions {
  /** True voor admin-rol (full edit). */
  canEdit: boolean
  /** True als het account hoofd-admin / role='admin' is. */
  isAdmin: boolean
  /** Indien gezet: deze gebruiker is gebonden aan één specifieke BV en mag
   *  alleen data van die BV zien. null = geen restrictie (admin / algemeen). */
  lockedBv: ClosingBv | null
}

export const PermissionsContext = createContext<Permissions>({
  canEdit: false,
  isAdmin: false,
  lockedBv: null,
})

export function usePermissions(): Permissions {
  return useContext(PermissionsContext)
}

/** Korte helper als je alleen canEdit nodig hebt. */
export function useCanEdit(): boolean {
  return usePermissions().canEdit
}

/** Korte helper: BV waar deze gebruiker aan vastzit (null = geen restrictie). */
export function useLockedBv(): ClosingBv | null {
  return usePermissions().lockedBv
}
