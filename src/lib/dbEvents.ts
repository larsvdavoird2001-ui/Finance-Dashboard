/** Global event bus voor data-laag fouten. Wanneer een upsert/fetch faalt
 *  publiceren we hier een event zodat de UI er een toast van kan maken.
 *  Hierdoor zien admins direct wanneer hun edits niet in Supabase
 *  terechtkomen — geen meer "opgeslagen in localStorage maar niet in DB"
 *  mysteries.  */

type DbEvent =
  | { type: 'save-error'; table: string; message: string }
  | { type: 'load-error'; table: string; message: string }

/** Schema/cache-issues die wel willen we loggen maar NIET als toast tonen
 *  (anders krijgt de gebruiker bij elke load 8 alarm-popups). */
const SUPPRESSED_PATTERNS = [
  /Could not find the .+ column of/i,
  /could not find the .+ in the schema cache/i,
  /relation .+ does not exist/i,
  /schema cache/i,
]
function shouldSuppress(msg: string): boolean {
  return SUPPRESSED_PATTERNS.some(re => re.test(msg))
}

type Listener = (e: DbEvent) => void

const listeners = new Set<Listener>()

export function emitDbEvent(e: DbEvent) {
  if (shouldSuppress(e.message)) {
    // Schema-issues los je op met de SQL-migraties, niet via een paniektoast.
    console.warn(`[db-event] ${e.type} on ${e.table} (suppressed): ${e.message}`)
    return
  }
  console.error(`[db-event] ${e.type} on ${e.table}: ${e.message}`)
  for (const l of listeners) {
    try { l(e) } catch (err) { console.warn('[db-event] listener threw:', err) }
  }
}

export function onDbEvent(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
