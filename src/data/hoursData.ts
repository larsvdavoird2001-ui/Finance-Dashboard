import type { HoursRecord } from './types'

// Monthly hours data per BV for 2026
// Derived from SAP timesheets:
//   Consultancy: detachering BV, ~14k hrs/month, ~95% declarable
//   Projects:    engineering BV, ~3.1k hrs/month, ~75% declarable
//   Software:    software BV,    ~2.7k hrs/month, ~75% declarable
//
// type = 'actual'   → gesloten maanden met SAP-data  (Jan–Mar)
// type = 'current'  → lopende maand met gedeeltelijke data (Apr)
// type = 'forecast' → toekomstige maanden op basis van capaciteitsplan (May–Dec)

export const ACTUAL_MONTHS   = ['Jan-26', 'Feb-26', 'Mar-26']
export const CURRENT_MONTH   = 'Apr-26'
export const FORECAST_MONTHS = ['May-26', 'Jun-26', 'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26']

export const hoursData2026: HoursRecord[] = [
  // ── CONSULTANCY ──────────────────────────────────────────────────────────
  { bv: 'Consultancy', month: 'Jan-26', written: 14200, declarable: 13490, nonDeclarable: 710,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Feb-26', written: 13800, declarable: 13110, nonDeclarable: 690,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Mar-26', written: 14500, declarable: 13775, nonDeclarable: 725,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Apr-26', written:  8200, declarable:  7790, nonDeclarable: 410,  capacity: 15000, type: 'current' },
  { bv: 'Consultancy', month: 'May-26', written: 15200, declarable: 14440, nonDeclarable: 760,  capacity: 15800, type: 'forecast' },
  { bv: 'Consultancy', month: 'Jun-26', written: 12500, declarable: 11875, nonDeclarable: 625,  capacity: 14500, type: 'forecast' },
  { bv: 'Consultancy', month: 'Jul-26', written:  9800, declarable:  9310, nonDeclarable: 490,  capacity: 11000, type: 'forecast' },
  { bv: 'Consultancy', month: 'Aug-26', written:  9500, declarable:  9025, nonDeclarable: 475,  capacity: 11000, type: 'forecast' },
  { bv: 'Consultancy', month: 'Sep-26', written: 14000, declarable: 13300, nonDeclarable: 700,  capacity: 15000, type: 'forecast' },
  { bv: 'Consultancy', month: 'Oct-26', written: 14500, declarable: 13775, nonDeclarable: 725,  capacity: 15000, type: 'forecast' },
  { bv: 'Consultancy', month: 'Nov-26', written: 14000, declarable: 13300, nonDeclarable: 700,  capacity: 15000, type: 'forecast' },
  { bv: 'Consultancy', month: 'Dec-26', written: 11500, declarable: 10925, nonDeclarable: 575,  capacity: 12500, type: 'forecast' },

  // ── PROJECTS ─────────────────────────────────────────────────────────────
  { bv: 'Projects', month: 'Jan-26', written: 3200, declarable: 2400, nonDeclarable: 800, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Feb-26', written: 3100, declarable: 2325, nonDeclarable: 775, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Mar-26', written: 3300, declarable: 2475, nonDeclarable: 825, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Apr-26', written: 1900, declarable: 1425, nonDeclarable: 475, capacity: 3600, type: 'current' },
  { bv: 'Projects', month: 'May-26', written: 3500, declarable: 2625, nonDeclarable: 875, capacity: 3800, type: 'forecast' },
  { bv: 'Projects', month: 'Jun-26', written: 2900, declarable: 2175, nonDeclarable: 725, capacity: 3600, type: 'forecast' },
  { bv: 'Projects', month: 'Jul-26', written: 2500, declarable: 1875, nonDeclarable: 625, capacity: 3000, type: 'forecast' },
  { bv: 'Projects', month: 'Aug-26', written: 2300, declarable: 1725, nonDeclarable: 575, capacity: 3000, type: 'forecast' },
  { bv: 'Projects', month: 'Sep-26', written: 3000, declarable: 2250, nonDeclarable: 750, capacity: 3600, type: 'forecast' },
  { bv: 'Projects', month: 'Oct-26', written: 3200, declarable: 2400, nonDeclarable: 800, capacity: 3600, type: 'forecast' },
  { bv: 'Projects', month: 'Nov-26', written: 3100, declarable: 2325, nonDeclarable: 775, capacity: 3600, type: 'forecast' },
  { bv: 'Projects', month: 'Dec-26', written: 2600, declarable: 1950, nonDeclarable: 650, capacity: 3000, type: 'forecast' },

  // ── SOFTWARE ─────────────────────────────────────────────────────────────
  { bv: 'Software', month: 'Jan-26', written: 2600, declarable: 1950, nonDeclarable: 650, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Feb-26', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Mar-26', written: 2800, declarable: 2100, nonDeclarable: 700, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Apr-26', written: 1500, declarable: 1125, nonDeclarable: 375, capacity: 3200, type: 'current' },
  { bv: 'Software', month: 'May-26', written: 3000, declarable: 2250, nonDeclarable: 750, capacity: 3200, type: 'forecast' },
  { bv: 'Software', month: 'Jun-26', written: 2500, declarable: 1875, nonDeclarable: 625, capacity: 3000, type: 'forecast' },
  { bv: 'Software', month: 'Jul-26', written: 2000, declarable: 1500, nonDeclarable: 500, capacity: 2500, type: 'forecast' },
  { bv: 'Software', month: 'Aug-26', written: 1900, declarable: 1425, nonDeclarable: 475, capacity: 2500, type: 'forecast' },
  { bv: 'Software', month: 'Sep-26', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'forecast' },
  { bv: 'Software', month: 'Oct-26', written: 2800, declarable: 2100, nonDeclarable: 700, capacity: 3000, type: 'forecast' },
  { bv: 'Software', month: 'Nov-26', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'forecast' },
  { bv: 'Software', month: 'Dec-26', written: 2200, declarable: 1650, nonDeclarable: 550, capacity: 2500, type: 'forecast' },
]

// ── 2025 ACTUAL HOURS (alle maanden gesloten) ────────────────────────────
// Gebaseerd op FY2025 P&L data (ytdActuals2025) — licht lager dan 2026 (groei)
export const hoursData2025: HoursRecord[] = [
  // CONSULTANCY (avg 14k/mnd, seizoensmatige correctie jul/aug/dec)
  { bv: 'Consultancy', month: 'Jan-25', written: 13800, declarable: 13110, nonDeclarable: 690,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Feb-25', written: 13600, declarable: 12920, nonDeclarable: 680,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Mar-25', written: 14200, declarable: 13490, nonDeclarable: 710,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Apr-25', written: 14400, declarable: 13680, nonDeclarable: 720,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'May-25', written: 14800, declarable: 14060, nonDeclarable: 740,  capacity: 15500, type: 'actual' },
  { bv: 'Consultancy', month: 'Jun-25', written: 14200, declarable: 13490, nonDeclarable: 710,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Jul-25', written:  9600, declarable:  9120, nonDeclarable: 480,  capacity: 11000, type: 'actual' },
  { bv: 'Consultancy', month: 'Aug-25', written:  9400, declarable:  8930, nonDeclarable: 470,  capacity: 11000, type: 'actual' },
  { bv: 'Consultancy', month: 'Sep-25', written: 13900, declarable: 13205, nonDeclarable: 695,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Oct-25', written: 14300, declarable: 13585, nonDeclarable: 715,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Nov-25', written: 13900, declarable: 13205, nonDeclarable: 695,  capacity: 15000, type: 'actual' },
  { bv: 'Consultancy', month: 'Dec-25', written: 11200, declarable: 10640, nonDeclarable: 560,  capacity: 12500, type: 'actual' },

  // PROJECTS (avg 3.3k/mnd)
  { bv: 'Projects', month: 'Jan-25', written: 3100, declarable: 2325, nonDeclarable: 775, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Feb-25', written: 3000, declarable: 2250, nonDeclarable: 750, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Mar-25', written: 3300, declarable: 2475, nonDeclarable: 825, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Apr-25', written: 3500, declarable: 2625, nonDeclarable: 875, capacity: 3800, type: 'actual' },
  { bv: 'Projects', month: 'May-25', written: 3600, declarable: 2700, nonDeclarable: 900, capacity: 3800, type: 'actual' },
  { bv: 'Projects', month: 'Jun-25', written: 3400, declarable: 2550, nonDeclarable: 850, capacity: 3800, type: 'actual' },
  { bv: 'Projects', month: 'Jul-25', written: 2400, declarable: 1800, nonDeclarable: 600, capacity: 3000, type: 'actual' },
  { bv: 'Projects', month: 'Aug-25', written: 2200, declarable: 1650, nonDeclarable: 550, capacity: 3000, type: 'actual' },
  { bv: 'Projects', month: 'Sep-25', written: 3200, declarable: 2400, nonDeclarable: 800, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Oct-25', written: 3400, declarable: 2550, nonDeclarable: 850, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Nov-25', written: 3300, declarable: 2475, nonDeclarable: 825, capacity: 3600, type: 'actual' },
  { bv: 'Projects', month: 'Dec-25', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'actual' },

  // SOFTWARE (avg 2.8k/mnd)
  { bv: 'Software', month: 'Jan-25', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Feb-25', written: 2600, declarable: 1950, nonDeclarable: 650, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Mar-25', written: 2800, declarable: 2100, nonDeclarable: 700, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Apr-25', written: 2900, declarable: 2175, nonDeclarable: 725, capacity: 3200, type: 'actual' },
  { bv: 'Software', month: 'May-25', written: 3000, declarable: 2250, nonDeclarable: 750, capacity: 3200, type: 'actual' },
  { bv: 'Software', month: 'Jun-25', written: 2800, declarable: 2100, nonDeclarable: 700, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Jul-25', written: 1900, declarable: 1425, nonDeclarable: 475, capacity: 2500, type: 'actual' },
  { bv: 'Software', month: 'Aug-25', written: 1800, declarable: 1350, nonDeclarable: 450, capacity: 2500, type: 'actual' },
  { bv: 'Software', month: 'Sep-25', written: 2700, declarable: 2025, nonDeclarable: 675, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Oct-25', written: 2900, declarable: 2175, nonDeclarable: 725, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Nov-25', written: 2800, declarable: 2100, nonDeclarable: 700, capacity: 3000, type: 'actual' },
  { bv: 'Software', month: 'Dec-25', written: 2200, declarable: 1650, nonDeclarable: 550, capacity: 2500, type: 'actual' },
]

export const MONTHS_2025 = [
  'Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25',
  'Jul-25','Aug-25','Sep-25','Oct-25','Nov-25','Dec-25',
]

export const MONTHS_2026 = [
  'Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26',
  'Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26',
]

export const BVS: Array<'Consultancy' | 'Projects' | 'Software'> = ['Consultancy', 'Projects', 'Software']

export function getHours(bv: 'Consultancy' | 'Projects' | 'Software' | 'all', month: string | 'all'): HoursRecord[] {
  return hoursData2026.filter(r =>
    (bv === 'all' || r.bv === bv) &&
    (month === 'all' || r.month === month)
  )
}

export function sumHours(records: HoursRecord[]) {
  return records.reduce(
    (acc, r) => ({
      written: acc.written + r.written,
      declarable: acc.declarable + r.declarable,
      nonDeclarable: acc.nonDeclarable + r.nonDeclarable,
      capacity: acc.capacity + r.capacity,
    }),
    { written: 0, declarable: 0, nonDeclarable: 0, capacity: 0 }
  )
}
