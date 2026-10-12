import express from 'express';
import multer from 'multer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractCvText } from './cv.js';
import { analyzeProfile } from './analysis.js';
import { buildRoadmap } from './roadmap.js';
import { matchJobs } from './jobs.js';
import { estimateSalary } from './salary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.limits.cvMaxBytes } });

const app = express();
app.use(express.static(path.join(root, 'public')));

app.get('/api/config', (_req, res) => res.json({ maxSkills: config.limits.maxSkills }));

app.post('/api/analyze', upload.single('cv'), async (req, res) => {
  let profile;
  try {
    const b = req.body;
    const skills = JSON.parse(b.skills || '[]').map((s) => String(s).trim()).filter(Boolean).slice(0, config.limits.maxSkills);
    const years = Number(b.years);
    if (!b.position?.trim() || !skills.length || !(years >= 0 && years <= 50)) {
      throw new Error('Position, years (0–50) and at least one skill are required.');
    }
    profile = {
      position: b.position.trim().slice(0, 100),
      years,
      skills,
      education: JSON.parse(b.education || '[]').slice(0, 5),
      cvText: await extractCvText(req.file),
    };
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (type, data) => res.write(JSON.stringify({ type, data }) + '\n');
  const fail = (panel, e) => {
    console.error(panel, e.message);
    send('error', { panel, message: e.message });
  };

  try {
    send('profile', { ...profile, cvText: undefined, cvUsed: !!profile.cvText });
    const analysis = await analyzeProfile(profile);
    send('gap', analysis);

    const jobsP = matchJobs(profile, analysis, config)
      .then((j) => {
        send('jobs', { jobs: j.jobs, sources: j.sources });
        return j;
      })
      .catch((e) => {
        fail('jobs', e);
        return { allJobs: [] };
      });
    const roadmapP = buildRoadmap(profile, analysis, config)
      .then((r) => send('roadmap', r))
      .catch((e) => fail('roadmap', e));
    const jobs = await jobsP;
    await estimateSalary(profile, analysis, config, jobs.allJobs || [])
      .then((s) => send('salary', s))
      .catch((e) => fail('salary', e));
    await roadmapP;
  } catch (e) {
    fail('gap', e);
  }
  send('done', {});
  res.end();
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'CV must be under 5 MB.' : err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Trajectory running at http://localhost:${port}`));
