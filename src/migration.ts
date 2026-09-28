import type { LocatedChange, Risk, SchemaChange } from './types.js';

// An identifier as it can appear in DDL: plain, "double quoted", `backticked` or [bracketed].
const IDENT = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
// Optionally schema-qualified: public.users, "app"."users".
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;

const re = (pattern: string) => new RegExp(pattern, 'i');

const ALTER_TABLE = re(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})\s+(.+)$`);
const RENAME_TABLES = re(String.raw`^RENAME\s+TABLES?\s+(.+)$`);
const DROP_TABLE = re(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+(?:CASCADE|RESTRICT))?$`);

const ACTION_RENAME_TO = re(String.raw`^RENAME\s+TO\s+(${QUALIFIED})$`);
const ACTION_RENAME_COLUMN = re(String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})$`);
const ACTION_DROP_COLUMN = re(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${IDENT})(?:\s+(?:CASCADE|RESTRICT))?$`);
const ACTION_ALTER_TYPE = re(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(?:SET\s+DATA\s+)?TYPE\s+(.+)$`);
const ACTION_SET_NOT_NULL = re(String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+SET\s+NOT\s+NULL$`);
const ACTION_MODIFY = re(String.raw`^MODIFY\s+(?:COLUMN\s+)?(${IDENT})\s+(.+)$`);
const ACTION_CHANGE = re(String.raw`^CHANGE\s+(?:COLUMN\s+)?(${IDENT})\s+(${IDENT})\s+(.+)$`);

// Words that follow RENAME/DROP but name something other than a column.
const NOT_A_COLUMN = new Set(['constraint', 'index', 'key', 'primary', 'foreign', 'check', 'partition', 'default', 'trigger']);

/** Strip quoting from an identifier: "users" -> users, `users` -> users, [users] -> users. */
export function unquote(identifier: string): string {
  const id = identifier.trim();
  const first = id[0];
  const last = id[id.length - 1];
  if ((first === '"' && last === '"') || (first === '`' && last === '`') || (first === '[' && last === ']')) {
    return id.slice(1, -1);
  }
  return id;
}

/** public.users -> users. Code usually refers to the table without its schema. */
function tableName(qualified: string): string {
  const parts = splitTopLevel(qualified, '.');
  return unquote(parts[parts.length - 1] ?? qualified);
}

/** If a Postgres dollar-quoted string ($$ ... $$ or $tag$ ... $tag$) starts at i, return the index just past it. */
function skipDollarQuote(sql: string, i: number): number | null {
  const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i, i + 64));
  if (!tag) return null;
  const end = sql.indexOf(tag[0], i + tag[0].length);
  return end === -1 ? sql.length : end + tag[0].length;
}

/**
 * Replace comments with spaces while keeping newlines, so line numbers stay correct.
 * Quoted strings, identifiers and dollar-quoted function bodies are left alone.
 */
export function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (!quote && ch === '$') {
      const end = skipDollarQuote(sql, i);
      if (end !== null) {
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (quote === "'" && next === "'") {
          out += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Split on a separator that is not inside quotes or parentheses. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

interface Statement {
  text: string;
  line: number;
}

/** Split a migration into statements, remembering the line each one starts on. */
export function splitStatements(sql: string): Statement[] {
  const clean = stripComments(sql);
  const statements: Statement[] = [];
  let quote: string | null = null;
  let start = 0;
  const flush = (end: number) => {
    const raw = clean.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) {
      const line = clean.slice(0, start + leading).split('\n').length;
      statements.push({ text: text.replace(/\s+/g, ' '), line });
    }
    start = end + 1;
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '$') {
      const end = skipDollarQuote(clean, i);
      if (end !== null) {
        i = end - 1;
        continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === ';') flush(i);
  }
  flush(clean.length);
  return statements;
}

function parseAlterAction(table: string, action: string): SchemaChange[] {
  const firstWords = action.split(/\s+/).slice(0, 2).map((w) => w.toLowerCase());
  if ((firstWords[0] === 'rename' || firstWords[0] === 'drop') && NOT_A_COLUMN.has(firstWords[1] ?? '')) {
    return [];
  }

  let m = action.match(ACTION_RENAME_TO);
  if (m) return [{ kind: 'rename_table', table, to: tableName(m[1]!) }];

  m = action.match(ACTION_RENAME_COLUMN);
  if (m) return [{ kind: 'rename_column', table, column: unquote(m[1]!), to: unquote(m[2]!) }];

  m = action.match(ACTION_DROP_COLUMN);
  if (m) return [{ kind: 'drop_column', table, column: unquote(m[1]!) }];

  m = action.match(ACTION_SET_NOT_NULL);
  if (m) return [{ kind: 'set_not_null', table, column: unquote(m[1]!) }];

  m = action.match(ACTION_ALTER_TYPE);
  if (m) {
    const newType = m[2]!.split(/\s+USING\s+/i)[0]!.trim();
    return [{ kind: 'alter_column_type', table, column: unquote(m[1]!), newType }];
  }

  m = action.match(ACTION_CHANGE);
  if (m) {
    const from = unquote(m[1]!);
    const to = unquote(m[2]!);
    if (from.toLowerCase() !== to.toLowerCase()) return [{ kind: 'rename_column', table, column: from, to }];
    return [{ kind: 'alter_column_type', table, column: from, newType: m[3]!.trim() }];
  }

  m = action.match(ACTION_MODIFY);
  if (m) return [{ kind: 'alter_column_type', table, column: unquote(m[1]!), newType: m[2]!.trim() }];

  return [];
}

/** Every schema change a single statement makes. Non-breaking statements (CREATE, ADD COLUMN, ...) yield nothing. */
export function parseStatement(statement: string): SchemaChange[] {
  let m = statement.match(ALTER_TABLE);
  if (m) {
    const table = tableName(m[1]!);
    return splitTopLevel(m[2]!, ',').flatMap((action) => parseAlterAction(table, action));
  }

  m = statement.match(RENAME_TABLES);
  if (m) {
    return splitTopLevel(m[1]!, ',').flatMap((pair): SchemaChange[] => {
      const p = pair.match(re(String.raw`^(${QUALIFIED})\s+TO\s+(${QUALIFIED})$`));
      return p ? [{ kind: 'rename_table', table: tableName(p[1]!), to: tableName(p[2]!) }] : [];
    });
  }

  m = statement.match(DROP_TABLE);
  if (m) {
    return splitTopLevel(m[1]!, ',').map((t): SchemaChange => ({ kind: 'drop_table', table: tableName(t) }));
  }

  return [];
}

export function riskOf(change: SchemaChange): Risk {
  return change.kind === 'alter_column_type' || change.kind === 'set_not_null' ? 'risky' : 'breaking';
}

export function changeKey(change: SchemaChange): string {
  switch (change.kind) {
    case 'rename_table':
    case 'drop_table':
      return `${change.kind}:${change.table}`;
    default:
      return `${change.kind}:${change.table}.${change.column}`;
  }
}

/** Parse one migration file into located schema changes. */
export function parseMigration(sql: string, file = '<migration>'): LocatedChange[] {
  const changes: LocatedChange[] = [];
  const seen = new Map<string, number>();
  for (const statement of splitStatements(sql)) {
    for (const change of parseStatement(statement.text)) {
      const key = changeKey(change);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      changes.push({
        id: count === 1 ? key : `${key}#${count}`,
        change,
        risk: riskOf(change),
        source: { file, line: statement.line, statement: statement.text },
      });
    }
  }
  return changes;
}

/** One-line human description of a change, e.g. "users.full_name renamed to name". */
export function describe(change: SchemaChange): string {
  switch (change.kind) {
    case 'rename_column':
      return `${change.table}.${change.column} renamed to ${change.to}`;
    case 'drop_column':
      return `${change.table}.${change.column} dropped`;
    case 'alter_column_type':
      return `${change.table}.${change.column} type changed to ${change.newType}`;
    case 'set_not_null':
      return `${change.table}.${change.column} set to NOT NULL`;
    case 'rename_table':
      return `table ${change.table} renamed to ${change.to}`;
    case 'drop_table':
      return `table ${change.table} dropped`;
  }
}
