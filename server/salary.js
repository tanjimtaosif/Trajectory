import { chatJSON } from './llm.js';
import { fetchWithTimeout, htmlToText, median, slugify } from './util.js';

function fill(tpl, role) {
  return tpl
    .replace('{roleSlug}', slugify(role))
    .replace('{roleLen}', String(role.length))
    .replace('{roleTitle}', encodeURIComponent(role.replace(/ /g, '_')))
    .replace('{roleQuery}', encodeURIComponent(role));
}

const squash = (s) => s.replace(/[\s,]+/g, '').toLowerCase();

async function pageText(url) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html' } }, 10000);
  if (!res.ok) throw new Error(String(res.status));
  const text = htmlToText(await res.text());
  // keep only windows around money amounts to stay within token limits
  const wins = [];
  const re = /(?:[$£€]|USD|EUR|GBP|BDT|৳)\s?\d[\d,.]*\s?[kK]?/g;
  let m;
  let last = -1;
  while ((m = re.exec(text)) && wins.length < 40) {
    if (m.index < last) continue;
    wins.push(text.slice(Math.max(0, m.index - 140), m.index + 140));
    last = m.index + 140;
  }
  return { text, snippet: wins.join(' … ').slice(0, 6000) };
}

function parseFeedSalary(t) {
  const nums = [...String(t).matchAll(/(\d[\d,.]*)\s?([kK])?/g)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => n >= 1000);
  if (!nums.length) return null;
  const currency = /€|eur/i.test(t) ? 'EUR' : /£|gbp/i.test(t) ? 'GBP' : 'USD';
  return { low: Math.min(...nums), high: Math.max(...nums), currency, period: 'year', level: 'any', source: 'Job listings', quote: t };
}

const PERIOD = { year: 1, month: 12, week: 52, hour: 2080, day: 260 };

export async function estimateSalary(profile, analysis, config, jobs) {
  const sources = config.salarySources.filter((s) => s.enabled);
  const points = [];
  const tried = [];

  await Promise.all(
    sources.map(async (s) => {
      try {
        const { text, snippet } = await pageText(fill(s.url, profile.position));
        if (!snippet) {
          tried.push({ name: s.name, ok: false, note: 'no salary figures on page' });
          return;
        }
        const r = await chatJSON(
          'You extract salary figures from web page text. Respond with a single JSON object only. Never invent numbers.',
          `Role of interest: ${profile.position}. Extract salary figures that clearly refer to this role (or a very close variant). Each must be copied from the text.
Return {"points":[{"low":number,"high":number,"currency":"USD","period":"year|month|week|day|hour","level":"junior|mid|senior|lead|any","quote":"verbatim excerpt (max 120 chars) containing the figure"}]}. If a single figure, low=high. Return {"points":[]} if nothing relevant.
TEXT: ${snippet}`,
          { maxTokens: 1200 },
        );
        const flat = squash(text);
        let n = 0;
        for (const p of r.points || []) {
          if (!p.quote || !(p.low > 0) || !(p.high >= p.low)) continue;
          if (!flat.includes(squash(String(p.quote)))) continue; // must appear verbatim in the source
          points.push({ ...p, source: s.name });
          n++;
        }
        tried.push({ name: s.name, ok: n > 0, note: n ? `${n} figures` : 'no usable figures' });
      } catch (e) {
        tried.push({ name: s.name, ok: false, note: `unavailable (${e.name === 'AbortError' ? 'timeout' : e.message})` });
      }
    }),
  );

  if (config.salary.useJobFeedSalaries) {
    let n = 0;
    for (const j of jobs) {
      const p = j.salaryText && parseFeedSalary(j.salaryText);
      if (p) {
        points.push(p);
        n++;
      }
    }
    if (n) tried.push({ name: 'Job listings', ok: true, note: `${n} figures` });
  }

  const usable = points
    .filter((p) => PERIOD[p.period])
    .map((p) => ({ ...p, low: p.low * PERIOD[p.period], high: p.high * PERIOD[p.period] }))
    .filter((p) => p.low >= 1000);
  if (!usable.length) return { insufficient: true, tried };

  const counts = {};
  usable.forEach((p) => (counts[p.currency] = (counts[p.currency] || 0) + 1));
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  let pts = usable.filter((p) => p.currency === currency);

  const lvl = analysis.level.toLowerCase();
  const key = /lead/.test(lvl) ? 'lead' : /senior/.test(lvl) ? 'senior' : /mid/.test(lvl) ? 'mid' : 'junior';
  const exact = pts.filter((p) => p.level === key);
  const withAny = pts.filter((p) => p.level === key || p.level === 'any' || !p.level);
  const min = config.salary.minDataPoints;
  pts = exact.length >= min ? exact : withAny.length >= min ? withAny : pts;

  if (pts.length < min) return { insufficient: true, tried, reason: 'Too few data points were found to give a reliable estimate.' };

  const low = Math.round(median(pts.map((p) => p.low)));
  const high = Math.round(median(pts.map((p) => p.high)));
  const mid = Math.round(median(pts.map((p) => (p.low + p.high) / 2)));
  const used = [...new Set(pts.map((p) => p.source))];
  const confidence = used.length >= 3 && pts.length >= 6 ? 'High' : used.length >= 2 ? 'Medium' : 'Low';

  const note = await chatJSON(
    'You explain salary estimates. Respond with a single JSON object only. Do not change or add numbers.',
    `Estimated range: ${low}-${high} ${currency}/yr, median ${mid}, computed from ${pts.length} figures across sources: ${used.join(', ')}.
Person: ${profile.position}, ${profile.years} years, level ${analysis.level}, skills ${analysis.have.join(', ')}; missing: ${analysis.missing.slice(0, 4).map((m) => m.skill).join(', ')}.
Return {"note":"1-2 sentences on where in the range this person likely sits and why, referencing experience and skills. No new figures."}`,
    { maxTokens: 300 },
  )
    .then((r) => String(r.note || ''))
    .catch(() => '');

  return { low, high, median: mid, currency, confidence, note, tried, sources: used, points: pts.length };
}
