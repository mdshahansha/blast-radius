import { describe } from './migration.js';
import type { Analysis, Confidence, SchemaChange } from './types.js';

const HINTS: Record<SchemaChange['kind'], string> = {
  rename_column:
    'Safer rollout: add the new column, backfill, move reads and writes over, then drop the old one (expand/contract).',
  drop_column: 'Ship the code that stops reading and writing this column first. Drop it in a later deploy.',
  alter_column_type: 'Check casts, comparisons, ORM types and anything that parses this value.',
  set_not_null: 'Any insert or update that leaves this column out will now fail.',
  rename_table: 'Keep a view with the old name until every caller has moved, or rename in two deploys.',
  drop_table: 'Make sure nothing still reads or writes this table before dropping it.',
};

export function summarize(analysis: Analysis): Record<Confidence, number> {
  const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const finding of analysis.findings) counts[finding.confidence]++;
  return counts;
}

export function formatText(analysis: Analysis): string {
  const out: string[] = [];
  const { changes, findings } = analysis;

  if (changes.length === 0) {
    return 'No breaking or risky schema changes found in the migration.\n';
  }

  out.push(
    `Blast Radius: ${changes.length} schema change${changes.length === 1 ? '' : 's'}, ` +
      `${analysis.filesScanned} file${analysis.filesScanned === 1 ? '' : 's'} scanned`,
    '',
  );

  for (const located of changes) {
    const label = located.risk === 'breaking' ? 'BREAKING' : 'RISKY';
    out.push(`[${label}] ${describe(located.change)}`);
    out.push(`  from ${located.source.file}:${located.source.line}`);

    const hits = findings.filter((f) => f.changeId === located.id);
    if (hits.length === 0) {
      out.push('  No references found in the scanned code.');
    }
    for (const hit of hits) {
      out.push(`  ${hit.confidence.toUpperCase().padEnd(6)}  ${hit.file}:${hit.line}`);
      out.push(`          ${hit.snippet}`);
      out.push(`          -> ${hit.reason}`);
    }
    if (hits.length > 0) out.push(`  Tip: ${HINTS[located.change.kind]}`);
    out.push('');
  }

  const counts = summarize(analysis);
  const files = new Set(findings.map((f) => f.file)).size;
  out.push(
    `Result: ${counts.high} high, ${counts.medium} medium, ${counts.low} low ` +
      `across ${files} file${files === 1 ? '' : 's'}.`,
  );
  return `${out.join('\n')}\n`;
}

export function formatJson(analysis: Analysis): string {
  return `${JSON.stringify(
    {
      changes: analysis.changes.map((c) => ({ ...c, description: describe(c.change) })),
      findings: analysis.findings,
      filesScanned: analysis.filesScanned,
      summary: summarize(analysis),
    },
    null,
    2,
  )}\n`;
}
