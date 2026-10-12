import { chatJSON } from './llm.js';
import { fetchWithTimeout } from './util.js';

function allowedHost(url, domains) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith('.' + d)) ? host : null;
  } catch {
    return null;
  }
}

async function reachable(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetchWithTimeout(url, { method }, 7000);
      if (res.status < 400 || [401, 403, 429].includes(res.status)) return true;
      if (method === 'GET' || res.status === 404 || res.status === 410) return false;
    } catch {
      if (method === 'GET') return false;
    }
  }
  return false;
}

export async function buildRoadmap(profile, analysis, config) {
  const skills = analysis.priorities.map((p) => p.skill);
  const r = await chatJSON(
    'You design focused learning plans. Respond with a single JSON object only. Only cite real, well-known resources with real URLs from official documentation or established learning platforms; never invent URLs.',
    `Target role: ${profile.position}. Experience: ${profile.years} years. Already knows: ${analysis.have.join(', ')}.
Create a learning roadmap for these skills, in this order: ${skills.join(', ')}.
Return JSON: {"steps":[{"skill":"exact name from the list","hours":number,"resources":[{"title":"","url":"https://...","type":"Doc|Tutorial|Course|Book|Video|Roadmap"}],"project":"one practical build idea tailored to the person's existing stack, max 20 words"}]}
Give 2-3 resources per skill, preferring official docs and free material. Use stable top-level or well-known docs URLs.`,
    { maxTokens: 3500 },
  );
  const steps = await Promise.all(
    (r.steps || []).map(async (s) => {
      const cands = (s.resources || [])
        .map((x) => ({ ...x, host: allowedHost(String(x.url), config.learningSources) }))
        .filter((x) => x.host && x.title);
      const checks = await Promise.all(cands.map((c) => reachable(c.url)));
      return {
        skill: String(s.skill),
        hours: Math.round(Number(s.hours) || 0),
        project: String(s.project || ''),
        resources: cands
          .filter((_, i) => checks[i])
          .map((c) => ({ title: String(c.title), url: c.url, type: String(c.type || 'Doc'), host: c.host })),
      };
    }),
  );
  return { steps };
}
