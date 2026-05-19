import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only middleware die /api/chat lokaal afhandelt. In productie verzorgt
 * Vercel deze route via api/chat.ts (Edge function); in `vite dev` is dat
 * endpoint er niet, dus zonder deze plugin krijgt elke AI-call een 404 en
 * wordt de AI-overlay stilletjes uitgeschakeld.
 *
 * Vereist: ANTHROPIC_API_KEY in .env (zelfde key als de Vercel env var).
 */
function apiChatDevPlugin(env: Record<string, string>): PluginOption {
  return {
    name: 'api-chat-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = env.ANTHROPIC_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            error: 'ANTHROPIC_API_KEY ontbreekt in .env — voeg de key toe en herstart `npm run dev`.',
          }))
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const bodyText = Buffer.concat(chunks).toString('utf8')

        let body: {
          system?: string
          messages?: Array<{ role: 'user' | 'assistant'; content: string }>
          model?: string
          max_tokens?: number
        }
        try {
          body = JSON.parse(bodyText)
        } catch {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
          return
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'messages[] is verplicht' }))
          return
        }

        try {
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: body.model ?? 'claude-sonnet-4-6',
              max_tokens: body.max_tokens ?? 2048,
              system: body.system,
              messages: body.messages,
            }),
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', 'application/json')
          res.end(text)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            error: `Claude API fetch faalde: ${err instanceof Error ? err.message : String(err)}`,
          }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiChatDevPlugin(env)],
  }
})
