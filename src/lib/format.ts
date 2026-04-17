export function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const formatted = abs >= 1000
    ? abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : abs.toFixed(0)
  return (v < 0 ? '−' : '') + '€\u00a0' + formatted
}

export function parseNL(s: string): number {
  const raw = s.replace(/€/g,'').replace(/\u00a0/g,'').replace(/\s/g,'').replace(/−/g,'-').replace(/\./g,'').replace(/,/g,'.')
  const v = parseFloat(raw)
  return isNaN(v) ? 0 : v
}

export function gv(dict: Record<string, number | null> | undefined, m: string): number {
  if (!dict) return 0
  const v = dict[m]
  return v != null ? v : 0
}
