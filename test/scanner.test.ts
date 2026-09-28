import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigration } from '../src/migration.js';
import { scanContent } from '../src/scanner.js';

const renameFullName = parseMigration('ALTER TABLE users RENAME COLUMN full_name TO name;');
const renameName = parseMigration('ALTER TABLE users RENAME COLUMN name TO display_name;');
const dropUsers = parseMigration('DROP TABLE users;');

const levels = (content: string, changes = renameFullName) =>
  scanContent(content, 'f.ts', changes).map((f) => [f.line, f.confidence]);

test('SQL on the same table is high confidence, even when the table is on another line', () => {
  const code = ['db.query(`SELECT id, full_name', '  FROM users', ' WHERE id = $1`)'].join('\n');
  assert.deepEqual(levels(code), [[1, 'high']]);
});

test('qualified and aliased references are high confidence', () => {
  assert.deepEqual(levels('SELECT users.full_name FROM accounts'), [[1, 'high']]);
  const sql = ['SELECT u.full_name', 'FROM orders o', 'JOIN users u ON u.id = o.user_id'].join('\n');
  const [finding] = scanContent(sql, 'r.sql', renameFullName);
  assert.equal(finding!.confidence, 'high');
  assert.match(finding!.reason, /alias u/);
});

test('property reads and field declarations in related code are medium', () => {
  const dto = ['interface UserRow { full_name: string }', 'const out = { fullName: row.full_name };'].join('\n');
  assert.deepEqual(levels(dto), [
    [1, 'medium'],
    [2, 'medium'],
  ]);
});

test('generic column names need table context', () => {
  // `name` on an unrelated object must not be reported for users.name
  assert.deepEqual(levels('const label = product.name;', renameName), []);
  // but it is reported when the query is on users
  assert.deepEqual(levels("db.query('SELECT name FROM users')", renameName), [[1, 'high']]);
});

test('casts are not object keys, and longer identifiers are not matches', () => {
  assert.deepEqual(levels('SELECT full_name::text FROM accounts'), []);
  assert.deepEqual(levels('const x = full_name_backup;'), []);
});

test('table drops flag SQL clauses and ORM table names', () => {
  const code = ["knex('users').where({ id })", 'SELECT * FROM users', 'const users = await list();'].join('\n');
  assert.deepEqual(levels(code, dropUsers), [
    [1, 'medium'],
    [2, 'high'],
  ]);
});
