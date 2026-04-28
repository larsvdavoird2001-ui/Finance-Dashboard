import { createContext, useContext } from 'react'

/** Permissies-context. Default = view-only zodat een vergeten Provider
 *  nooit per ongeluk schrijfrechten geeft. */
export interface Permissions {
  /** True voor admin-rol (full edit). */
  canEdit: boolean
  /** True als het account hoofd-admin / role='admin' is. */
  isAdmin: boolean
}

export const PermissionsContext = createContext<Permissions>({
  canEdit: false,
  isAdmin: false,
})

export function usePermissions(): Permissions {
  return useContext(PermissionsContext)
}

/** Korte helper als je alleen canEdit nodig hebt. */
export function useCanEdit(): boolean {
  return usePermissions().canEdit
}
