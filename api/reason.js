// POST /api/reason  { ticker, payload }
// Standard-mode explanation. Receives ONLY computed metrics/subscores from the browser
// (never raw web data) and asks Claude to explain the score without inventing figures.
import Anthropic from '@anthropic-ai/sdk';
import { sendJson, sendError, requireEnv } from './_lib/http.js';

const MODEL = 'claude-sonnet-5-5'; // current Claude Sonnet

const SYSTEM = `You are an equity analyst writing a short, plain-English explanation of a quantitative "conviction score".
Rules you must follow:
- Use ONLY the numbers in the JSON payload. Do not invent, estimate, or recall any figure that is not in the payload. If something is missing, say it is unavailable.
- Do not give personalized investment advice or tell the reader to buy or sell.
- Write in Markdown with exactly these sections: "## What drove the score", "## Strongest bull points", "## Strongest bear points", "## Key risks".
- Each bullet should cite the specific metric and value from the payload that supports it.
- Keep it under 350 words.`;

const PORTFOLIO_SYSTEM = `You are an equity analyst reviewing a reader's portfolio thesis against quantitative model output.
Rules you must follow:
- Use ONLY the numbers in the JSON payload. Do not invent, estimate, or recall any figure that is not in the payload. If something is missing, say it is unavailable.
- The "thesis" field is the reader's own words. Judge whether the numbers support it; do not add facts about the companies beyond the payload.
- Do not give personalized investment advice or tell the reader to buy or sell.
- Write in Markdown with exactly these sections: "## Does the data support the thesis?", "## What helps", "## What hurts", "## What would have to be true".
- Each bullet should cite the specific metric and value from the payload that supports it.
- Keep it under 400 words.`;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only.' });
    const apiKey = requireEnv('ANTHROPIC_API_KEY');
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { ticker, payload } = body;
    if (!ticker || !payload) return sendJson(res, 400, { error: 'Missing ticker or payload.' });

    const text = JSON.stringify(payload);
    if (text.length > 80000) return sendJson(res, 413, { error: 'Payload too large.' });
    const isPortfolio = payload.kind === 'portfolio';

    // Pin the base URL so a stray ANTHROPIC_BASE_URL in the environment (e.g. a local proxy) cannot redirect the call.
    const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1800,
      system: isPortfolio ? PORTFOLIO_SYSTEM : SYSTEM,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: isPortfolio
            ? `Portfolio: ${ticker}\n\nComputed portfolio and per-holding metrics, parameters and the reader's thesis (JSON):\n${text}\n\nAssess whether the numbers support the thesis and the growth target over the stated horizon, what helps, what hurts, and what would have to be true for the target to be met.`
            : `Ticker: ${ticker}\n\nComputed metrics and subscores (JSON):\n${text}\n\nExplain what drove the conviction score, the strongest bull and bear points from these numbers, and the key risks.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return sendJson(res, 200, { text: null, error: 'The model declined to answer this request.', model: MODEL });
    }
    const out = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    sendJson(res, 200, { text: out, model: MODEL, usage: response.usage });
  } catch (err) {
    if (err.status === 401) err.message = 'Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY: it should start with "sk-ant-" and have no quotes or spaces.';
    else if (err.status === 429) err.message = 'Anthropic rate limit or credit limit reached (429). Add credit or try again in a minute.';
    else if (err.status === 400 && /credit/i.test(err.message)) err.message = 'Anthropic account has no credit balance. Add credit at console.anthropic.com → Billing.';
    sendError(res, err);
  }
}
