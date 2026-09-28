#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';
import { formatJson, formatText } from './report.js';
import type { Analysis, Confidence } from './types.js';

const USAGE = `Usage: blast-radius <migration.sql | migrations-dir>... [options]

Reads SQL migrations, finds breaking schema changes, and lists the code they are likely to break.

Options:
  --src <dir>             Code to scan (default: current directory)
  --json                  Print JSON instead of text
  --fail-on <level>       Exit 1 when a finding is at least: high | medium | low | never (default: high)
  --include-migrations    Also scan files inside migrations/ folders
  -h, --help              Show this help
`;

const LEVELS: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(argv: string[], cwd = process.cwd()): CliResult {
  const migrations: string[] = [];
  let src: string | undefined;
  let json = false;
  let failOn: Confidence | 'never' = 'high';
  let includeMigrations = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') return { code: 0, stdout: USAGE, stderr: '' };
    if (arg === '--json') json = true;
    else if (arg === '--include-migrations') includeMigrations = true;
    else if (arg === '--src') src = argv[++i];
    else if (arg === '--fail-on') {
      const level = argv[++i];
      if (level !== 'high' && level !== 'medium' && level !== 'low' && level !== 'never') {
        return { code: 2, stdout: '', stderr: `Unknown --fail-on level: ${level ?? '(missing)'}\n\n${USAGE}` };
      }
      failOn = level;
    } else if (arg.startsWith('-')) {
      return { code: 2, stdout: '', stderr: `Unknown option: ${arg}\n\n${USAGE}` };
    } else migrations.push(arg);
  }

  if (migrations.length === 0) return { code: 2, stdout: '', stderr: USAGE };

  let analysis: Analysis;
  try {
    analysis = analyze({ migrations, src, cwd, includeMigrations });
  } catch (error) {
    return { code: 2, stdout: '', stderr: `blast-radius: ${(error as Error).message}\n` };
  }

  const failing =
    failOn !== 'never' && analysis.findings.some((f) => LEVELS[f.confidence] >= LEVELS[failOn as Confidence]);
  return { code: failing ? 1 : 0, stdout: json ? formatJson(analysis) : formatText(analysis), stderr: '' };
}

// Run only when executed directly, not when imported by tests.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  const result = run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
