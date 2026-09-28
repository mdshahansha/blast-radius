export { analyze, resolveMigrationFiles, type AnalyzeOptions } from './analyze.js';
export { parseMigration, parseStatement, describe } from './migration.js';
export { scanContent, listSourceFiles, DEFAULT_EXTENSIONS, type ScanOptions } from './scanner.js';
export { formatText, formatJson, summarize } from './report.js';
export type { Analysis, Confidence, Finding, LocatedChange, Risk, SchemaChange } from './types.js';
