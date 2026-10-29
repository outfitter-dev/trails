"""Check this research packet without rewriting project artifacts."""

import hashlib
import json
import re
import subprocess
from pathlib import Path


packet = Path(__file__).resolve().parent
root = packet.parents[2]
inventory = json.loads((packet / 'evidence/inventory.json').read_text())
coverage = json.loads((packet / 'coverage.json').read_text())
canon = json.loads((packet / 'canon.json').read_text())
failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


baseline = inventory['baseline']
check(coverage['baseline'] == baseline, 'Coverage baseline mismatch')
check(canon['baseline'] == baseline, 'Canon baseline mismatch')
check(coverage['resetCutoff'] is None, 'Proposal must not choose the reset cutoff')
paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', baseline, 'docs/adr'], cwd=root, text=True).splitlines()
actual = sorted(p for p in paths if re.fullmatch(r'docs/adr/(?:drafts/)?[^/]+\.md', p) and not p.endswith('/README.md'))
recorded = [r['path'] for r in inventory['records']]
mapped = [r['path'] for r in coverage['records']]
check(len(recorded) == len(set(recorded)), 'Duplicate inventory entries')
check(len(mapped) == len(set(mapped)), 'Duplicate disposition entries')
check(actual == sorted(recorded), 'Filesystem inventory mismatch')
check(actual == sorted(mapped), 'Missing or extra dispositions')
check(len(actual) == 77, 'Expected pinned 77-record census changed')
for row in inventory['records']:
    digest = hashlib.sha256(subprocess.check_output(['git', 'show', baseline + ':' + row['path']], cwd=root)).hexdigest()
    check(digest == row['sha256'], 'Source changed: ' + row['path'])

ids = {r['id'] for r in canon['records']}
check(len(ids) == len(canon['records']) == 25, 'Canon IDs not unique/complete')
check(ids == {f'N{n:02}' for n in range(1, 26)}, 'Unexpected canon ID set')
by_id = {r['id']: r for r in canon['records']}
for row in coverage['records']:
    for field in ('normativeHomes', 'lineageHomes', 'proposedSubstanceHomes'):
        check(set(row.get(field, [])) <= ids, f'Unknown home in {row["path"]}')
    if row['kind'] == 'numbered' and row['disposition'] != 'historical-only':
        check(bool(row['normativeHomes']), 'No surviving home: ' + row['path'])
    if row['kind'] == 'draft':
        check(not row['normativeHomes'], 'Draft silently marked normative')
    check(bool(row['notes']), 'Missing disposition rationale')

visited = set()


def visit(key, chain):
    if key in chain:
        failures.append('Dependency cycle: ' + ' -> '.join([*chain, key]))
        return
    if key in visited:
        return
    for dep in by_id[key]['dependsOn']:
        if dep not in ids:
            failures.append('Unknown dependency: ' + dep)
        else:
            visit(dep, [*chain, key])
    visited.add(key)


for key in sorted(ids):
    visit(key, [])

outline = (packet / 'outline.md').read_text()
for row in canon['records']:
    check(f"### {row['id']} — {row['title']}" in outline, 'Outline/JSON title drift')
    check(f"`{row['filename']}`" in outline, 'Outline/JSON filename drift')

link_count = 0
for doc in packet.glob('*.md'):
    text = doc.read_text()
    for raw in re.findall(r'\]\(([^)]+)\)', text):
        target = raw.strip('<>').split('#', 1)[0]
        if not target or re.match(r'[a-z]+:', target):
            continue
        link_count += 1
        check((doc.parent / target).exists(), f'Missing local link in {doc.name}: {target}')
    check(not any(line.endswith(' ') for line in text.splitlines()),
          'Trailing whitespace in ' + doc.name)

commits = json.loads((packet / 'evidence/commits.json').read_text())
for entry in commits:
    actual_sha = subprocess.check_output(
        ['git', 'rev-parse', entry['sha']], cwd=root, text=True
    ).strip()
    check(actual_sha == entry['sha'], 'Invalid commit anchor')
    raw = subprocess.check_output(
        ['git', 'show', '--format=fuller', '--no-ext-diff', entry['sha']],
        cwd=root, text=True
    )
    check(hashlib.sha256(raw.encode()).hexdigest() == entry['patchSha256'],
          'Preserved patch differs: ' + entry['sha'])

summary = {
    'baseline': baseline,
    'numbered': sum(r['kind'] == 'numbered' for r in coverage['records']),
    'drafts': sum(r['kind'] == 'draft' for r in coverage['records']),
    'proposedDecisions': len(ids),
    'dependencyGraph': 'acyclic' if not any('cycle' in f for f in failures) else 'failed',
    'localLinksChecked': link_count,
    'pivotalPatchesChecked': len(commits),
    'failures': failures,
    'limits': 'Structural evidence checks; not clause-level equivalence, runtime tests, remote URL checks, or semantic ratification.',
}
print(json.dumps(summary, indent=2))
raise SystemExit(1 if failures else 0)
