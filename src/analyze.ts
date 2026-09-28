import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { parseMigration } from './migration.js';
import { listSourceFiles, scanFiles, toPosix, type ScanOptions } from './scanner.js';
import type { Analysis, LocatedChange } from './types.js';

export interface AnalyzeOptions extends ScanOptions {
  /** Migration files or directories of .sql files. */
  migrations: string[];
  /** Root of the code to scan. Defaults to the current directory. */
  src?: string;
  /** Base for the paths shown in results. Defaults to the current directory. */
  cwd?: string;
}

/** Expand directories into their .sql files (sorted, so migrations keep their order). */
export function resolveMigrationFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    const full = resolve(path);
    if (statSync(full).isDirectory()) {
      const sql = readdirSync(full)
        .filter((name) => extname(name).toLowerCase() === '.sql')
        .sort()
        .map((name) => join(full, name));
      files.push(...sql);
    } else {
      files.push(full);
    }
  }
  return files;
}

export function analyze(options: AnalyzeOptions): Analysis {
  const cwd = resolve(options.cwd ?? process.cwd());
  const src = resolve(cwd, options.src ?? '.');
  const migrationFiles = resolveMigrationFiles(options.migrations.map((m) => resolve(cwd, m)));

  const changes: LocatedChange[] = migrationFiles.flatMap((file) =>
    parseMigration(readFileSync(file, 'utf8'), toPosix(relative(cwd, file))),
  );

  if (changes.length === 0) return { changes, findings: [], filesScanned: 0 };

  const files = listSourceFiles(src, {
    extensions: options.extensions,
    includeMigrations: options.includeMigrations,
    exclude: [...(options.exclude ?? []), ...migrationFiles],
  });
  const findings = scanFiles(cwd, files, changes);
  return { changes, findings, filesScanned: files.length };
}
