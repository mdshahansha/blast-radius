# Blast Radius

See what a database schema change will break **before** you deploy it.

Rename one column and three queries can break silently, with nothing failing until real traffic hits them.
Blast Radius reads your SQL migration, finds the breaking changes, and lists the code that still depends on
the old schema.

> Status: **v0.1, early.** It is a fast, text-based scanner, not a SQL compiler. Read the limits below.
> I'm building it in public. Progress notes live in [BUILDLOG.md](BUILDLOG.md).

## What it catches

| Migration change | Risk |
| --- | --- |
| `RENAME COLUMN`, MySQL `CHANGE old new` | breaking |
| `DROP COLUMN` | breaking |
| `RENAME TO`, `RENAME TABLE` | breaking |
| `DROP TABLE` | breaking |
| `ALTER COLUMN ... TYPE`, MySQL `MODIFY` | risky |
| `ALTER COLUMN ... SET NOT NULL` | risky |

For every change it scans your code (`.ts .js .sql .py .java .go .rb .php .cs .prisma .graphql` and more) and
rates each hit:

- **high**: a SQL statement on the same table uses the column (`FROM users ... full_name`, `users.full_name`, or an alias like `u.full_name`)
- **medium**: code reads or declares the field near related code (`row.full_name`, `full_name: string`), which often ends up in an API response
- **low**: the name is mentioned in code related to the table

Generic names like `id` or `name` are only reported with real table context, to keep noise down.
Files inside `migrations/` folders are skipped by default.

## Try it

```bash
git clone https://github.com/mdshahansha/blast-radius.git
cd blast-radius
npm install
npm run demo
```

The demo migration renames `users.full_name` and drops `users.legacy_score`. Real output:

```text
Blast Radius: 2 schema changes, 5 files scanned

[BREAKING] users.full_name renamed to name
  from examples/demo-app/migrations/20260928_rename_full_name.sql:2
  HIGH    examples/demo-app/src/orders/orderReport.sql:1
          SELECT o.id, o.total, u.full_name AS customer
          -> references full_name through alias u (u = users)
  HIGH    examples/demo-app/src/users/userRepository.ts:5
          `SELECT id, email, full_name
          -> a query on users uses full_name
  HIGH    examples/demo-app/src/users/userRepository.ts:14
          return db.query('SELECT id, full_name FROM users WHERE full_name ILIKE $1', [`%${term}%`]);
          -> a query on users uses full_name
  MEDIUM  examples/demo-app/src/users/userDto.ts:4
          full_name: string;
          -> declares field full_name (type, DTO or payload)
  MEDIUM  examples/demo-app/src/users/userDto.ts:12
          fullName: row.full_name,
          -> reads field full_name; this may feed an API response
  Tip: Safer rollout: add the new column, backfill, move reads and writes over, then drop the old one (expand/contract).

[BREAKING] users.legacy_score dropped
  from examples/demo-app/migrations/20260928_rename_full_name.sql:4
  HIGH    examples/demo-app/src/users/userRepository.ts:18
          return db.query('SELECT id, email FROM users ORDER BY legacy_score DESC LIMIT 10');
          -> a query on users uses legacy_score
  Tip: Ship the code that stops reading and writing this column first. Drop it in a later deploy.

Result: 4 high, 2 medium, 0 low across 3 files.
```

## Use it on your project

```bash
npm run build
node dist/src/cli.js path/to/migration.sql --src path/to/your/app
node dist/src/cli.js db/migrations/ --src . --json      # a whole folder, JSON output
```

| Option | Meaning |
| --- | --- |
| `--src <dir>` | Code to scan (default: current directory) |
| `--json` | JSON output for scripts and CI |
| `--fail-on high\|medium\|low\|never` | Exit code 1 when a finding reaches this level (default: `high`) |
| `--include-migrations` | Also scan files inside `migrations/` folders |

Exit codes: `0` nothing at the fail level, `1` findings at or above it, `2` bad input.

## Limits (v0.1)

- Text and regex based. It does not parse your code or run your queries.
- Aliases are resolved only within a few lines of the match.
- No ORM model mapping yet (Prisma, TypeORM, Sequelize, Django). A model field with a different name than the column is missed.
- It cannot see queries built from strings at runtime.
- Postgres and MySQL syntax only.

## Roadmap

- [ ] Resolve aliases and CTEs across the whole statement, not a line window
- [ ] Map ORM models to tables and columns
- [ ] Trace a column to the API fields that expose it
- [ ] GitHub Action that comments the blast radius on pull requests
- [ ] Foreign key and constraint changes

Ideas and bug reports are welcome in [Issues](https://github.com/mdshahansha/blast-radius/issues).

## Development

```bash
npm install
npm test        # builds, then runs the node:test suite
```

## License

[MIT](LICENSE) © Mohammad Shahansha
