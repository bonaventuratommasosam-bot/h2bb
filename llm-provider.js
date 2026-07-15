// LLM provider — Groq / Gemini / OpenRouter (tier gratuito)
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS, 10) || 8000;

const PROVIDERS = {
  groq: {
    name: 'groq',
    env: ['GROQ_API_KEY'],
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.1-8b-instant',
    free: true,
  },
  gemini: {
    name: 'gemini',
    env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.0-flash',
    free: true,
  },
  openrouter: {
    name: 'openrouter',
    env: ['OPENROUTER_API_KEY'],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
    free: true,
    extraHeaders: { 'HTTP-Referer': 'https://hermesbro.cloud', 'X-Title': 'HermesBro Trading' },
  },
  opengateway: {
    name: 'opengateway',
    env: ['OPENGATEWAY_API_KEY', 'XIAOMI_API_KEY'],
    url: process.env.OPENGATEWAY_BASE_URL || 'https://opengateway.gitlawb.com/v1/xiaomi-mimo/chat/completions',
    defaultModel: process.env.OPENGATEWAY_MODEL || 'mimo-v2.5-pro',
    free: true,
  },
  grok: {
    name: 'grok',
    env: ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'],
    url: `${(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '')}/chat/completions`,
    defaultModel: 'grok-3-mini',
    free: false,
  },
  deepseek: {
    name: 'deepseek',
    env: ['DEEPSEEK_API_KEY'],
    url: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    free: false,
  },
};

function pickKey(envNames) {
  for (const name of envNames) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

function resolveConfig() {
  const want = (process.env.LLM_PROVIDER || 'auto').toLowerCase().split(',').map((s) => s.trim());
  const order = want.includes('auto')
    ? ['groq', 'gemini', 'openrouter', 'opengateway', 'grok', 'deepseek']
    : want;

  for (const id of order) {
    const p = PROVIDERS[id];
    if (!p) continue;
    const key = pickKey(p.env);
    if (!key) continue;
    return {
      enabled: true,
      provider: p.name,
      url: p.url,
      key,
      model: process.env.LLM_MODEL || p.defaultModel,
      timeout: LLM_TIMEOUT_MS,
      free: !!p.free,
      extraHeaders: p.extraHeaders || {},
    };
  }

  return { enabled: false, provider: null, reason: 'nessuna API key LLM (Groq/Gemini gratis su console)' };
}

function statusLine() {
  const c = resolveConfig();
  if (!c.enabled) return `[LLM] off — template locali (${c.reason})`;
  const tag = c.free ? 'gratis' : 'paid';
  return `[LLM] ${c.provider} · ${c.model} (${tag})`;
}

module.exports = { resolveConfig, statusLine, LLM_TIMEOUT_MS, PROVIDERS };