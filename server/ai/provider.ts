// The language model behind the room DJ, configured by whoever hosts Earshot. Called from the server
// only, so the API key never reaches a browser and the page's CSP stays as strict as before.
//   AI_PROVIDER  openai (default: any OpenAI-compatible /chat/completions — OpenAI, OpenRouter, Groq,
//                Together, Gemini, Ollama, LM Studio, vLLM, llama.cpp…) or anthropic (/v1/messages)
//   AI_BASE_URL  defaults to the provider's public API
//   AI_API_KEY   optional for local servers
//   AI_MODEL     required; AI is off without it
//   AI_TIMEOUT_MS  default 30000 (local models can be slow)
// What the model sees: song titles/artists/lengths, display names and recent chat. Never audio.

export interface AiRequest { system: string; user: string; maxTokens: number }
export interface AiClient { complete(req: AiRequest): Promise<string> }

export class AiError extends Error {}

type Fetch = typeof fetch
type Env = Record<string, string | undefined>

const DEFAULT_BASE = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' }

export function aiFromEnv(env: Env = process.env, fetchImpl: Fetch = fetch): AiClient | null {
  const model = env.AI_MODEL?.trim()
  if (!model) return null
  const provider = env.AI_PROVIDER?.trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai'
  const base = (env.AI_BASE_URL?.trim() || DEFAULT_BASE[provider]).replace(/\/+$/, '')
  const key = env.AI_API_KEY?.trim()
  const timeoutMs = Number(env.AI_TIMEOUT_MS) > 0 ? Number(env.AI_TIMEOUT_MS) : 30_000

  const post = async (url: string, headers: Record<string, string>, body: unknown): Promise<any> => {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new AiError((err as Error).name === 'TimeoutError' ? 'The AI took too long to answer.' : "Couldn't reach the AI service.")
    }
    if (!res.ok) {
      // Log the status only: response bodies can echo request details, and we never log the key.
      console.warn(`[ai] ${provider} answered HTTP ${res.status}`)
      throw new AiError(res.status === 429 ? 'The AI is busy right now. Try again in a minute.' : "The AI service didn't accept the request.")
    }
    try { return await res.json() } catch { throw new AiError('The AI sent back something unreadable.') }
  }

  if (provider === 'anthropic') {
    return {
      async complete({ system, user, maxTokens }) {
        const data = await post(`${base}/v1/messages`, {
          ...(key ? { 'x-api-key': key } : {}),
          'anthropic-version': '2023-06-01',
        }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
        const text = Array.isArray(data?.content)
          ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
          : ''
        if (!text) throw new AiError('The AI sent back an empty answer.')
        return text
      },
    }
  }

  return {
    async complete({ system, user, maxTokens }) {
      const data = await post(`${base}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, {
        model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      })
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text) throw new AiError('The AI sent back an empty answer.')
      return text
    },
  }
}
