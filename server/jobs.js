import { chatJSON } from './llm.js';
import { fetchWithTimeout, htmlToText, norm, tokens } from './util.js';

async function getJSON(url) {
  const res = await fetchWithTimeout(url, {}, 10000);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const adapters = {
  async remotive(src, role) {
    const d = await getJSON(`${src.url}?search=${encodeURIComponent(role)}&limit=40`);
    return (d.jobs || []).map((j) => ({
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location || 'Remote',
      mode: 'Remote',
      url: j.url,
      description: htmlToText(j.description || ''),
      salaryText: j.salary || '',
      source: src.name,
    }));
  },
  async arbeitnow(src) {
    const out = [];
    for (const page of [1, 2]) {
      const d = await getJSON(`${src.url}?page=${page}`);
      for (const j of d.data || []) {
        out.push({
          title: j.title,
          company: j.company_name,
          location: j.location || '',
          mode: j.remote ? 'Remote' : 'On-site',
          url: j.url,
          description: htmlToText(j.description || ''),
          salaryText: '',
          source: src.name,
        });
      }
    }
    return out;
  },
  async themuse(src, role) {
    const out = [];
    for (const page of [0, 1, 2]) {
      const d = await getJSON(`${src.url}?page=${page}&descending=true&q=${encodeURIComponent(role)}`);
      for (const j of d.results || []) {
        const locs = (j.locations || []).map((l) => l.name).join(', ');
        out.push({
          title: j.name,
          company: j.company?.name || '',
          location: locs,
          mode: /flexible|remote/i.test(locs) ? 'Remote' : 'On-site',
          url: j.refs?.landing_page,
          description: htmlToText(j.contents || ''),
          salaryText: '',
          source: src.name,
        });
      }
    }
    return out;
  },
};

export async function fetchJobs(role, config) {
  const sources = config.jobSources.filter((s) => s.enabled && adapters[s.type]);
  const results = await Promise.allSettled(sources.map((s) => adapters[s.type](s, role)));
  const names = [];
  const all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) {
      all.push(...r.value);
      names.push(sources[i].name);
    }
  });
  return { jobs: all.filter((j) => j.url && j.title), sources: names };
}

const STOP = new Set(['senior', 'junior', 'lead', 'staff', 'principal', 'sr', 'jr', 'ii', 'iii', 'i']);

function rank(jobs, role, skills) {
  const roleTok = tokens(role).filter((t) => !STOP.has(t));
  const roleN = norm(role);
  const mine = skills.map(norm);
  return jobs
    .map((j) => {
      const tt = new Set(tokens(j.title));
      const hit = roleTok.filter((t) => tt.has(t)).length;
      if (!roleTok.length || hit / roleTok.length < 0.6) return null;
      const desc = norm(j.description);
      const sk = mine.filter((s) => s && desc.includes(s)).length;
      return { ...j, score: hit * 5 + (norm(j.title).includes(roleN) ? 5 : 0) + sk };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

export async function matchJobs(profile, analysis, config) {
  const { jobs, sources } = await fetchJobs(profile.position, config);
  const userSkills = [...profile.skills, ...analysis.have];
  const seen = new Set();
  const top = rank(jobs, profile.position, userSkills)
    .filter((j) => (seen.has(j.url) ? false : seen.add(j.url)))
    .slice(0, config.limits.maxJobs);
  if (!top.length) return { jobs: [], sources, allJobs: jobs };

  const ex = await chatJSON(
    'You extract hiring requirements. Respond with a single JSON object only.',
    `For each job, list the specific required skills/technologies/qualifications (max 8, canonical short names like "Kubernetes", "AWS", "PostgreSQL"). Only what the posting states.
Return {"jobs":[{"i":number,"required":["..."]}]}
${top.map((j, i) => `### ${i}\n${j.title} at ${j.company}\n${j.description.slice(0, 1800)}`).join('\n')}`,
    { maxTokens: 2500 },
  ).catch(() => ({ jobs: [] }));
  const reqs = new Map((ex.jobs || []).map((x) => [Number(x.i), (x.required || []).map(String)]));
  const mine = userSkills.map(norm);
  const has = (req) => {
    const r = norm(req);
    return mine.some((m) => m && (m === r || m.includes(r) || r.includes(m)));
  };

  return {
    sources,
    allJobs: jobs,
    jobs: top.map((j, i) => {
      const required = reqs.get(i) || [];
      const missing = required.filter((r) => !has(r));
      return {
        title: j.title,
        company: j.company,
        location: j.location,
        mode: j.mode,
        url: j.url,
        source: j.source,
        salaryText: j.salaryText,
        missing,
        requiredCount: required.length,
      };
    }),
  };
}
