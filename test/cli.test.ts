import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';

// Compiled tests live in dist/test, so the repo root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const migration = 'examples/demo-app/migrations/20260928_rename_full_name.sql';

test('demo app: finds the queries and DTO fields the migration breaks', () => {
  const result = run([migration, '--src', 'examples/demo-app', '--json'], root);
  assert.equal(result.code, 1, 'high findings should fail the run by default');
  const report = JSON.parse(result.stdout);

  const at = (changeId: string) =>
    report.findings
      .filter((f: { changeId: string }) => f.changeId === changeId)
      .map((f: { file: string; line: number; confidence: string }) => `${f.confidence} ${f.file}:${f.line}`);

  assert.deepEqual(at('rename_column:users.full_name'), [
    'high examples/demo-app/src/orders/orderReport.sql:1',
    'high examples/demo-app/src/users/userRepository.ts:5',
    'high examples/demo-app/src/users/userRepository.ts:14',
    'medium examples/demo-app/src/users/userDto.ts:4',
    'medium examples/demo-app/src/users/userDto.ts:12',
  ]);
  assert.deepEqual(at('drop_column:users.legacy_score'), ['high examples/demo-app/src/users/userRepository.ts:18']);
  assert.deepEqual(report.summary, { high: 4, medium: 2, low: 0 });
  assert.ok(
    !report.findings.some((f: { file: string }) => f.file.includes('billing') || f.file.includes('migrations')),
    'unrelated code and the migration itself are not reported',
  );
});

test('text output and exit codes', () => {
  const text = run([migration, '--src', 'examples/demo-app'], root);
  assert.match(text.stdout, /\[BREAKING\] users\.full_name renamed to name/);
  assert.match(text.stdout, /Result: 4 high, 2 medium, 0 low across 3 files\./);

  assert.equal(run([migration, '--src', 'examples/demo-app', '--fail-on', 'never'], root).code, 0);
  assert.equal(run([], root).code, 2);
  assert.equal(run([migration, '--fail-on', 'sometimes'], root).code, 2);
  assert.equal(run(['does-not-exist.sql'], root).code, 2);
});
