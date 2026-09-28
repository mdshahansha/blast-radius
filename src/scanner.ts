import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { Confidence, Finding, LocatedChange } from './types.js';

export const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sql', '.py', '.java', '.kt', '.go', '.rb', '.php', '.cs',
  '.prisma', '.graphql', '.gql',
];

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', 'target', 'out', '.venv', '__pycache__',
]);
// Old migrations mention every column they ever touched; scanning them is mostly noise.
const MIGRATION_DIRS = new Set(['migrations', 'migration', 'migrate']);
const MAX_FILE_BYTES = 1_000_000;
// How many lines around a match count as "the same query".
const WINDOW = 6;

// Words that can follow a table name in FROM/JOIN but are not aliases.
const NOT_AN_ALIAS = new Set([
  'where', 'on', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'group', 'order',
  'limit', 'offset', 'set', 'values', 'using', 'union', 'having', 'returning', 'as', 'select', 'from',
]);

export interface ScanOptions {
  extensions?: string[];
  includeMigrations?: boolean;
  /** Absolute paths that must not be scanned, e.g. the migration being analysed. */
  exclude?: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ID = '[A-Za-z0-9_$]';

/** Regexes for one table, built once per change instead of once per line. */
function tableMatchers(table: string) {
  const t = escape(table);
  return {
    /** users as a whole identifier */
    name: new RegExp(`(?<!${ID})${t}(?!${ID})`, 'i'),
    /** FROM users, JOIN public.users, UPDATE "users", INSERT INTO users, REFERENCES users */
    clause: new RegExp(`\\b(?:from|join|update|into|table|references)\\s+(?:[\\w"\`]+\\s*\\.\\s*)?["\`]?${t}["\`]?(?!${ID})`, 'i'),
    /** FROM users u / JOIN users AS u  ->  captures the alias */
    alias: () => new RegExp(`\\b(?:from|join)\\s+(?:[\\w"\`]+\\s*\\.\\s*)?["\`]?${t}["\`]?\\s+(?:as\\s+)?([A-Za-z_][A-Za-z0-9_]*)`, 'gi'),
    /** 'users' as a string literal: knex('users'), tableName: "users", @@map("users") */
    literal: new RegExp(`['"\`]${t}['"\`]`, 'i'),
    /** loose relation check: UserRow, userRepository, users */
    related: new RegExp(escape(table.length > 3 && /s$/i.test(table) ? table.slice(0, -1) : table), 'i'),
  };
}

function columnMatchers(column: string) {
  const c = escape(column);
  return {
    name: new RegExp(`(?<!${ID})${c}(?!${ID})`, 'i'),
    /** row.full_name, row?.full_name, row['full_name'] */
    property: new RegExp(`(?:\\?\\.|\\.)\\s*${c}(?!${ID})|\\[\\s*['"]${c}['"]\\s*\\]`, 'i'),
    /** full_name: string / { full_name: value } / "full_name": ...   (but not full_name::text) */
    key: new RegExp(`(?<![A-Za-z0-9_$.])['"]?${c}['"]?\\s*\\??\\s*:(?!:)`, 'i'),
  };
}

/** `owner.column`, allowing "quoted" or `backticked` parts. */
const qualified = (owner: string, column: string) =>
  new RegExp(`(?<!${ID})["\`]?${escape(owner)}["\`]?\\s*\\.\\s*["\`]?${escape(column)}["\`]?(?!${ID})`, 'i');

/** Column names like `id` or `name` exist in every table; only flag them with real table context. */
const isSpecific = (column: string) => column.includes('_') || column.length >= 8;

const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function listSourceFiles(root: string, options: ScanOptions = {}): string[] {
  const extensions = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()));
  const exclude = new Set((options.exclude ?? []).map((p) => resolve(p)));
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (!options.includeMigrations && MIGRATION_DIRS.has(entry.name.toLowerCase())) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (exclude.has(resolve(full))) continue;
        if (!extensions.has(extname(entry.name).toLowerCase())) continue;
        if (statSync(full).size > MAX_FILE_BYTES) continue;
        files.push(full);
      }
    }
  };

  walk(resolve(root));
  return files.sort();
}

interface Hit {
  confidence: Confidence;
  reason: string;
}

function classifyColumnHit(
  lines: string[],
  index: number,
  table: string,
  column: string,
  t: ReturnType<typeof tableMatchers>,
  c: ReturnType<typeof columnMatchers>,
  fileRelated: boolean,
): Hit | null {
  const line = lines[index]!;
  const window = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join('\n');

  if (qualified(table, column).test(line)) {
    return { confidence: 'high', reason: `references ${table}.${column} directly` };
  }

  for (const match of window.matchAll(t.alias())) {
    const alias = match[1]!;
    if (NOT_AN_ALIAS.has(alias.toLowerCase())) continue;
    if (qualified(alias, column).test(line)) {
      return { confidence: 'high', reason: `references ${column} through alias ${alias} (${alias} = ${table})` };
    }
  }

  const property = c.property.test(line);
  if (t.clause.test(window)) {
    return property
      ? { confidence: 'medium', reason: `reads ${column} from a ${table} query nearby` }
      : { confidence: 'high', reason: `a query on ${table} uses ${column}` };
  }

  if (property) {
    if (fileRelated) return { confidence: 'medium', reason: `reads field ${column}; this may feed an API response` };
    return isSpecific(column) ? { confidence: 'low', reason: `reads a field named ${column}` } : null;
  }

  if (c.key.test(line)) {
    if (fileRelated) return { confidence: 'medium', reason: `declares field ${column} (type, DTO or payload)` };
    return isSpecific(column) ? { confidence: 'low', reason: `declares a field named ${column}` } : null;
  }

  return fileRelated ? { confidence: 'low', reason: `mentions ${column} in code related to ${table}` } : null;
}

/** Find every line in `content` that one of the changes is likely to break. */
export function scanContent(content: string, file: string, changes: LocatedChange[]): Finding[] {
  const lines = content.split(/\r?\n/);
  const best = new Map<string, Finding>();

  const record = (located: LocatedChange, index: number, hit: Hit) => {
    const key = `${located.id}\u0000${index}`;
    const previous = best.get(key);
    if (previous && rank[previous.confidence] >= rank[hit.confidence]) return;
    best.set(key, {
      changeId: located.id,
      file,
      line: index + 1,
      snippet: lines[index]!.trim().slice(0, 140),
      confidence: hit.confidence,
      reason: hit.reason,
    });
  };

  for (const located of changes) {
    const { change } = located;
    const t = tableMatchers(change.table);

    if (change.kind === 'rename_table' || change.kind === 'drop_table') {
      lines.forEach((line, index) => {
        if (!t.name.test(line)) return;
        if (t.clause.test(line)) record(located, index, { confidence: 'high', reason: `SQL uses table ${change.table}` });
        else if (t.literal.test(line)) {
          record(located, index, {
            confidence: 'medium',
            reason: `string '${change.table}' looks like a table name (ORM or query builder)`,
          });
        }
      });
      continue;
    }

    const c = columnMatchers(change.column);
    if (!c.name.test(content)) continue;
    const fileRelated = t.name.test(content) || t.related.test(content);
    lines.forEach((line, index) => {
      if (!c.name.test(line)) return;
      const hit = classifyColumnHit(lines, index, change.table, change.column, t, c, fileRelated);
      if (hit) record(located, index, hit);
    });
  }

  return [...best.values()];
}

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** Scan files and return findings ordered by change, then confidence, then location. */
export function scanFiles(root: string, files: string[], changes: LocatedChange[]): Finding[] {
  const order = new Map(changes.map((c, i) => [c.id, i]));
  const findings: Finding[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    findings.push(...scanContent(content, toPosix(relative(root, file)), changes));
  }
  return findings.sort(
    (a, b) =>
      (order.get(a.changeId) ?? 0) - (order.get(b.changeId) ?? 0) ||
      rank[b.confidence] - rank[a.confidence] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}
