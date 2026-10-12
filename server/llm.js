const URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function chatJSON(system, user, { temperature = 0.2, maxTokens = 3000 } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  const body = {
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    temperature,
    max_tokens: maxTokens + 1500,
    response_format: { type: 'json_object' },
    ...(/gpt-oss/.test(process.env.GROQ_MODEL || 'openai/gpt-oss-120b') ? { reasoning_effort: 'low' } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Number(res.headers.get('retry-after')) || 2 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Groq API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    try {
      return JSON.parse(data.choices[0].message.content);
    } catch {
      throw new Error('LLM returned invalid JSON');
    }
  }
  throw new Error('Groq API rate limited');
}
