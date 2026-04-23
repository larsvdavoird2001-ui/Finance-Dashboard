/**
 * Vercel Edge serverless function — proxy naar de Anthropic Claude API.
 *
 * Verwacht env var: ANTHROPIC_API_KEY (ingesteld in Vercel dashboard).
 *
 * Body-format (POST JSON):
 *   {
 *     system: string             // system prompt met alle financiële context
 *     messages: Array<{ role: 'user' | 'assistant', content: string }>
 *     model?: string             // default: claude-sonnet-4-6
 *     max_tokens?: number        // default: 2048
 *   }
 *
 * Respons: JSON payload van Claude, client kleedt de tekst uit content[0].text.
 */
export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'ANTHROPIC_API_KEY niet ingesteld in Vercel env vars. Zet die in Settings → Environment Variables.',
    }), { status: 500, headers: { 'content-type': 'application/json' } })
  }

  let body: {
    system?: string
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    model?: string
    max_tokens?: number
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages[] is verplicht' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  }

  const payload = {
    model: body.model ?? 'claude-sonnet-4-6',
    max_tokens: body.max_tokens ?? 2048,
    system: body.system,
    messages: body.messages,
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await resp.text()
    return new Response(data, {
      status: resp.status,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({
      error: `Claude API fetch faalde: ${err instanceof Error ? err.message : String(err)}`,
    }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}
