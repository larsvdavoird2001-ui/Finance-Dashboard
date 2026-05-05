/**
 * Vercel Edge serverless function — admin invite via Supabase service-role.
 *
 * Doet drie dingen:
 *   1. Verifieert dat de aanroeper een admin is (via Supabase access token).
 *   2. Upsert in `user_profiles` met needs_password=true zodat de user bij
 *      eerste login op de SetPasswordPage uitkomt.
 *   3. Roept de Supabase Admin Invite API aan (`/auth/v1/invite`). Dit
 *      gebruikt de "Invite User" email-template (i.p.v. "Magic Link") en
 *      heeft niet de strikte 2/u rate-limit van signInWithOtp op default-SMTP.
 *
 * Vereiste Vercel environment variables:
 *   SUPABASE_URL                — bv. https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — Project Settings → API → service_role
 *
 * Body (POST JSON):
 *   { email: string, role: string, bv?: string | null, redirectTo?: string }
 *
 * Response:
 *   200 { ok: true }
 *   401 { error: 'UNAUTHORIZED' }
 *   403 { error: 'FORBIDDEN' }
 *   409 { error: 'ALREADY_REGISTERED' }   ← client kan dan fallback naar OTP
 *   501 { error: 'NOT_CONFIGURED' }       ← env vars ontbreken, client valt terug op OTP
 *   xxx { error: '...', message: '...' }  ← incl. rate-limit (429)
 */
export const config = { runtime: 'edge' }

const HARD_ADMIN_EMAIL = 'lvanderavoird@thepeoplegroup.nl'

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResp(405, { error: 'METHOD_NOT_ALLOWED' })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Bewust 501 zodat client kan onderscheiden van échte fouten en
    // netjes terug kan vallen op de client-side OTP-flow.
    return jsonResp(501, {
      error: 'NOT_CONFIGURED',
      message:
        'SUPABASE_SERVICE_ROLE_KEY en/of SUPABASE_URL ontbreken in Vercel environment variables.',
    })
  }

  // -- Stap 1: identificeer & autoriseer aanroeper -------------------------
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonResp(401, { error: 'UNAUTHORIZED', message: 'Bearer-token ontbreekt' })

  let callerEmail: string
  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    })
    if (!userResp.ok) {
      return jsonResp(401, { error: 'UNAUTHORIZED', message: 'Token afgewezen door Supabase' })
    }
    const u = await userResp.json()
    callerEmail = String(u?.email ?? '').toLowerCase()
    if (!callerEmail) return jsonResp(401, { error: 'UNAUTHORIZED', message: 'Geen email in token' })
  } catch (e) {
    return jsonResp(500, { error: 'AUTH_CHECK_FAILED', message: String(e) })
  }

  let isAdmin = callerEmail === HARD_ADMIN_EMAIL.toLowerCase()
  if (!isAdmin) {
    try {
      const profResp = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?select=role,active&email=eq.${encodeURIComponent(callerEmail)}`,
        {
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
        },
      )
      if (profResp.ok) {
        const arr = (await profResp.json()) as Array<{ role: string; active: boolean }>
        const p = arr?.[0]
        isAdmin = !!p && p.active && p.role === 'admin'
      }
    } catch {
      // Doorgaan met isAdmin=false → 403 hieronder
    }
  }
  if (!isAdmin) {
    return jsonResp(403, { error: 'FORBIDDEN', message: 'Alleen admins kunnen uitnodigen' })
  }

  // -- Stap 2: parse body ---------------------------------------------------
  let body: { email?: string; role?: string; bv?: string | null; redirectTo?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResp(400, { error: 'INVALID_BODY' })
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResp(400, { error: 'INVALID_EMAIL' })
  }
  const allowedRoles = ['viewer', 'editor', 'approver', 'admin']
  const role = allowedRoles.includes(String(body.role)) ? String(body.role) : 'viewer'
  const bv = body.bv ?? null
  const redirectTo = body.redirectTo

  // -- Stap 3: upsert user_profiles ---------------------------------------
  // needs_password=true zorgt dat de SetPasswordPage opent bij eerste login.
  try {
    const upsertResp = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        email,
        role,
        active: true,
        needs_password: true,
        invited_by: callerEmail,
        bv: role === 'admin' ? null : bv,
      }),
    })
    if (!upsertResp.ok) {
      const txt = await upsertResp.text()
      return jsonResp(500, { error: 'PROFILE_UPSERT_FAILED', message: txt })
    }
  } catch (e) {
    return jsonResp(500, { error: 'PROFILE_UPSERT_FAILED', message: String(e) })
  }

  // -- Stap 4: roep Admin-Invite API ---------------------------------------
  try {
    const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        data: { invited_role: role, invited_bv: bv ?? null },
        ...(redirectTo ? { redirect_to: redirectTo } : {}),
      }),
    })

    if (inviteResp.ok) {
      return jsonResp(200, { ok: true, mode: 'admin-invite' })
    }

    // Inspecteer fout
    const txt = await inviteResp.text()
    let parsed: { msg?: string; message?: string; error_code?: string; code?: string } | null = null
    try { parsed = JSON.parse(txt) } catch { /* niet-JSON respons, txt al gevuld */ }
    const msg = parsed?.msg ?? parsed?.message ?? txt
    const code = parsed?.error_code ?? parsed?.code ?? ''

    // User bestaat al → vertel client zodat die fallback kan doen (magic-link voor bestaande user)
    const looksLikeExisting =
      inviteResp.status === 422 ||
      /already.*registered/i.test(msg) ||
      /already.*been.*registered/i.test(msg) ||
      code === 'email_exists'
    if (looksLikeExisting) {
      return jsonResp(409, { error: 'ALREADY_REGISTERED', message: msg })
    }

    return jsonResp(inviteResp.status, {
      error: 'INVITE_FAILED',
      status: inviteResp.status,
      message: msg,
    })
  } catch (e) {
    return jsonResp(500, { error: 'INVITE_FAILED', message: String(e) })
  }
}
