import { chatJSON } from './llm.js';

const SYS = 'You are a precise career analyst. Respond with a single JSON object only.';

export async function analyzeProfile(p) {
  const prompt = `Target role: ${p.position}
Years of experience: ${p.years}
Skills: ${p.skills.join(', ')}
Education: ${p.education.map((e) => [e.degree, e.field, e.institution, e.year].filter(Boolean).join(', ')).join(' | ') || 'not given'}
CV text (may be empty):
"""${p.cvText || ''}"""

Compare this person against what employers currently require for the target role at their experience level.
Return JSON:
{
 "level": "Entry-level | Junior | Mid-level | Senior | Lead",
 "summary": "2 sentences describing the person's current position relative to the target",
 "have": ["skills (from the user's skills or CV) relevant to the target role, canonical names"],
 "missing": [{"skill": "name", "reason": "short reason, max 15 words"}],
 "priorities": [{"skill": "must be one of missing", "why": "max 10 words"}]
}
Rules: "missing" 4-10 items, most important first. "priorities" 3-5 items in learning order (foundations first). Only include skills genuinely relevant to the target role. Do not list as missing anything the user already has.`;
  const r = await chatJSON(SYS, prompt);
  const have = (r.have || []).map(String);
  const missing = (r.missing || []).filter((m) => m && m.skill).map((m) => ({ skill: String(m.skill), reason: String(m.reason || '') }));
  const names = new Set(missing.map((m) => m.skill.toLowerCase()));
  const priorities = (r.priorities || []).filter((x) => x && names.has(String(x.skill).toLowerCase()))
    .map((x) => ({ skill: String(x.skill), why: String(x.why || '') }));
  return { level: String(r.level || ''), summary: String(r.summary || ''), have, missing, priorities: priorities.length ? priorities : missing.slice(0, 4).map((m) => ({ skill: m.skill, why: m.reason })) };
}
