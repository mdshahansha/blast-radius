import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigration, parseStatement, splitStatements, stripComments } from '../src/migration.js';

test('rename column, with and without the COLUMN keyword', () => {
  assert.deepEqual(parseStatement('ALTER TABLE users RENAME COLUMN full_name TO name'), [
    { kind: 'rename_column', table: 'users', column: 'full_name', to: 'name' },
  ]);
  assert.deepEqual(parseStatement('ALTER TABLE users RENAME full_name TO name'), [
    { kind: 'rename_column', table: 'users', column: 'full_name', to: 'name' },
  ]);
});

test('quoted and schema-qualified identifiers', () => {
  assert.deepEqual(parseStatement('ALTER TABLE "public"."users" RENAME COLUMN "Full_Name" TO "name"'), [
    { kind: 'rename_column', table: 'users', column: 'Full_Name', to: 'name' },
  ]);
  assert.deepEqual(parseStatement('ALTER TABLE `shop`.`orders` DROP COLUMN `notes`'), [
    { kind: 'drop_column', table: 'orders', column: 'notes' },
  ]);
});

test('several actions in one ALTER TABLE, constraints ignored', () => {
  const changes = parseStatement(
    'ALTER TABLE IF EXISTS ONLY orders DROP COLUMN IF EXISTS coupon, ADD COLUMN note text, DROP CONSTRAINT orders_user_fk, DROP legacy CASCADE',
  );
  assert.deepEqual(changes, [
    { kind: 'drop_column', table: 'orders', column: 'coupon' },
    { kind: 'drop_column', table: 'orders', column: 'legacy' },
  ]);
});

test('type changes: Postgres TYPE, MySQL MODIFY and CHANGE', () => {
  assert.deepEqual(parseStatement('ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2) USING total::numeric'), [
    { kind: 'alter_column_type', table: 'orders', column: 'total', newType: 'numeric(12,2)' },
  ]);
  assert.deepEqual(parseStatement('ALTER TABLE users MODIFY COLUMN email VARCHAR(320) NOT NULL'), [
    { kind: 'alter_column_type', table: 'users', column: 'email', newType: 'VARCHAR(320) NOT NULL' },
  ]);
  assert.deepEqual(parseStatement('ALTER TABLE users CHANGE COLUMN full_name name VARCHAR(255)'), [
    { kind: 'rename_column', table: 'users', column: 'full_name', to: 'name' },
  ]);
});

test('SET NOT NULL is risky, harmless column edits are ignored', () => {
  assert.deepEqual(parseStatement('ALTER TABLE users ALTER COLUMN email SET NOT NULL'), [
    { kind: 'set_not_null', table: 'users', column: 'email' },
  ]);
  assert.deepEqual(parseStatement('ALTER TABLE users ALTER COLUMN email SET DEFAULT \'\''), []);
  assert.deepEqual(parseStatement('ALTER TABLE users ALTER COLUMN email DROP NOT NULL'), []);
  assert.deepEqual(parseStatement('CREATE INDEX users_email_idx ON users (email)'), []);
});

test('table renames and drops', () => {
  assert.deepEqual(parseStatement('ALTER TABLE users RENAME TO customers'), [
    { kind: 'rename_table', table: 'users', to: 'customers' },
  ]);
  assert.deepEqual(parseStatement('RENAME TABLE a TO b, c TO d'), [
    { kind: 'rename_table', table: 'a', to: 'b' },
    { kind: 'rename_table', table: 'c', to: 'd' },
  ]);
  assert.deepEqual(parseStatement('DROP TABLE IF EXISTS sessions, audit.logins CASCADE'), [
    { kind: 'drop_table', table: 'sessions' },
    { kind: 'drop_table', table: 'logins' },
  ]);
});

test('comments, strings and function bodies do not split statements', () => {
  const sql = [
    '-- rename; careful',
    "UPDATE users SET bio = 'a;b'; /* multi",
    'line; comment */',
    'CREATE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE nope; END $$ LANGUAGE plpgsql;',
    'ALTER TABLE users DROP COLUMN legacy_score;',
  ].join('\n');
  const statements = splitStatements(sql);
  assert.equal(statements.length, 3);
  assert.equal(statements[2]!.line, 5);
  assert.ok(!stripComments(sql).includes('careful'));

  const changes = parseMigration(sql, 'm.sql');
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0]!.change, { kind: 'drop_column', table: 'users', column: 'legacy_score' });
  assert.deepEqual(changes[0]!.source, { file: 'm.sql', line: 5, statement: 'ALTER TABLE users DROP COLUMN legacy_score' });
});

test('risk levels and stable ids', () => {
  const changes = parseMigration(
    'ALTER TABLE users DROP COLUMN a; ALTER TABLE users ALTER COLUMN b TYPE text; ALTER TABLE users DROP COLUMN a;',
  );
  assert.deepEqual(
    changes.map((c) => [c.id, c.risk]),
    [
      ['drop_column:users.a', 'breaking'],
      ['alter_column_type:users.b', 'risky'],
      ['drop_column:users.a#2', 'breaking'],
    ],
  );
});
