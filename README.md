# Trajectory

AI career guidance: skill-gap analysis, learning roadmap, matching jobs, and a salary estimate in one dashboard.

## Run
1. `npm install`
2. Copy `.env.example` to `.env` and set `GROQ_API_KEY`.
3. `npm start` → http://localhost:3000

## Configure (`config.json`)
- `jobSources` – job feeds (Remotive, Arbeitnow, The Muse); toggle with `enabled`.
- `salarySources` – any number of salary pages; `{roleSlug}`, `{roleTitle}`, `{roleQuery}` are substituted. Figures are only used if quoted verbatim from the page; the range is computed in code (median of extracted figures), never invented by the model.
- `learningSources` – allowed domains for roadmap links; links are also checked for reachability.
