/** Global event bus voor data-laag fouten. Wanneer een upsert/fetch faalt
 *  publiceren we hier een event zodat de UI er een toast van kan maken.
 *  Hierdoor zien admins direct wanneer hun edits niet in Supabase
 *  terechtkomen — geen meer "opgeslagen in localStorage maar niet in DB"
 *  mysteries.  */

type DbEvent =
  | { type: 'save-error'; table: string; message: string }
  | { type: 'load-error'; table: string; message: string }

type Listener = (e: DbEvent) => void

const listeners = new Set<Listener>()

export function emitDbEvent(e: DbEvent) {
  console.error(`[db-event] ${e.type} on ${e.table}: ${e.message}`)
  for (const l of listeners) {
    try { l(e) } catch (err) { console.warn('[db-event] listener threw:', err) }
  }
}

export function onDbEvent(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
