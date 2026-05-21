# Markdown Hard-Wrap Audit

Issue: `TRL-616`

Branch: `trl-616-audit-markdown-files-for-hard-line-wraps`

## Scope

The branch-ref broad detector pass found 328 candidates after excluding ADRs, releases,
migrations, archived plans, notes, scratch files, changelogs, generated Warden
guide blocks, fenced code, tables, lists, headings, blockquotes, and frontmatter.
That was too broad for a safe review-sized cleanup, so this branch narrowed the
edit scope to current-facing guidance and onboarding docs:

- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.claude/rules/coding-conventions.md`
- `.claude/skills/clark/references/calibrate.md`
- `docs/contributing/README.md`
- `docs/contributing/language-styleguide.md`
- `docs/getting-started.md`
- `docs/resources.md`
- `docs/surfaces/cli.md`
- `docs/testing.md`

## Detector

Exact broad detector command used before and after the cleanup:

```bash
node <<'NODE'
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const roots = ['README.md', 'AGENTS.md', '.agents/plans/PLANNING.md', 'docs', '.claude'];
const excluded = [/^\.agents\/plans\/archive\//, /^\.agents\/notes\//, /^\.scratch\//, /^\.agents\/plans\/v1\//, /^\.claude\/agent-memory\//, /^docs\/adr\//, /^docs\/releases\//, /^docs\/migration\//, /(^|\/)CHANGELOG\.md$/];
function walk(path,out=[]){ if(excluded.some(re=>re.test(path))) return out; const st=statSync(path,{throwIfNoEntry:false}); if(!st) return out; if(st.isDirectory()) for(const e of readdirSync(path).sort()) walk(join(path,e),out); else if(/\.mdx?$/.test(path)) out.push(path); return out; }
function isBoundary(line){ const t=line.trim(); return t===''||t.startsWith('#')||t.startsWith('```')||t.startsWith('~~~')||t.startsWith('|')||/^[-*+]\s/.test(t)||/^\d+\.\s/.test(t)||/^>/.test(t)||/^<!--/.test(t)||/^::/.test(t)||/^\[.+\]:/.test(t)||/^-{3,}$/.test(t)||/^---$/.test(t)||/^\s/.test(line); }
function endsHard(line){ const t=line.trim(); return t.length>0 && t.length<=110 && !/[.!?:;,\)\]\}`'"”’]$/.test(t); }
const hits=[]; for(const file of roots.flatMap(root=>walk(root))){ const lines=readFileSync(file,'utf8').split(/\r?\n/); let inFence=false,inGenerated=false,inFrontmatter=lines[0]?.trim()==='---'; for(let i=0;i<lines.length-1;i++){ const t=lines[i].trim(); if(i>0&&inFrontmatter&&t==='---'){inFrontmatter=false;continue;} if(t==='<!-- warden-guide:start -->') inGenerated=true; if(t==='<!-- warden-guide:end -->'){inGenerated=false;continue;} if(t.startsWith('```')||t.startsWith('~~~')) inFence=!inFence; if(inFence||inGenerated||inFrontmatter||isBoundary(lines[i])||isBoundary(lines[i+1])) continue; if(endsHard(lines[i])) hits.push({file,line:i+1}); }}
console.log(`candidates=${hits.length}`); const grouped=Map.groupBy(hits,h=>h.file); for(const [file,fileHits] of [...grouped.entries()].sort((a,b)=>b[1].length-a[1].length)) console.log(`${String(fileHits.length).padStart(4)} ${file}`);
NODE
```

## Results

- Broad detector before scoped cleanup: 328 candidates.
- Scoped files after cleanup: 0 candidates.
- Broad detector after scoped cleanup: 247 candidates, concentrated in larger
  docs that should be handled by follow-up slices rather than this PR.
- Mechanical prose joins applied: 55 joined lines.

## Safety Checks

- Changed files are limited to the 10 scoped markdown files above plus this report
  and the execution retro.
- No `.scratch/**`, `.agents/notes/**`, `.agents/plans/archive/**`, or changelog
  files were changed.
- Changed-line scan for the cleanup diff returned no matches for fences, tables,
  lists, generated Warden headings, and headings. The newly added report and
  retro ledger prose were reviewed separately:

```bash
git diff --unified=0 -- '*.md' | rg --pcre2 '^[+-](?![+-])\s*(```|~~~|\||[-*+]\s|\d+\.\s|<!-- warden-guide|<!-- GENERATED|#)' || true
```

- `git diff --check` passed.
- `bun run format:check` passed.
