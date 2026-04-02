import { writeFileSync } from 'node:fs';
import { INDEX_PATH } from './paths.ts';
import { listNumberedAdrs, parseAdrNumber, padNumber } from './discovery.ts';

export const rebuildIndex = (): void => {
  const adrs = listNumberedAdrs();
  const rows = adrs.map((adr) => {
    const num = parseAdrNumber(adr.filename);
    const displayNum = num === null ? '????' : padNumber(num);
    const title = adr.title.replace(/^ADR-\d+:\s*/, '');
    const status = String(adr.frontmatter.status ?? 'unknown');
    const capitalStatus = status.charAt(0).toUpperCase() + status.slice(1);
    return `| [${displayNum}](${adr.filename}) | ${title} | ${capitalStatus} |`;
  });

  const content = `# Architecture Decision Records

ADRs document the significant design decisions behind Trails — the choices that, if reversed, would produce a different framework. They capture the context, the decision, the consequences, and the alternatives considered.

## Index

| ADR | Title | Status |
| --- | --- | --- |
${rows.join('\n')}
`;

  writeFileSync(INDEX_PATH, content, 'utf8');
  console.log(`Updated ${INDEX_PATH}`);
};
