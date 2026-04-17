import { create } from 'zustand'

interface NavTarget {
  tab: 'maand'
  section: 'import'
  month: string
  slotId: string
}

interface NavStore {
  pending: NavTarget | null
  navigateTo: (target: NavTarget) => void
  consume: () => NavTarget | null
}

export const useNavStore = create<NavStore>((set, get) => ({
  pending: null,
  navigateTo: (target) => set({ pending: target }),
  consume: () => {
    const t = get().pending
    if (t) set({ pending: null })
    return t
  },
}))
