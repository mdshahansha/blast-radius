# Build log

Short notes while building Blast Radius in public. Newest first.

## Week 1

**Mon, 28 Sep 2026: Day 0**

- Repo is up. v0.1 CLI reads SQL migrations and finds breaking changes: rename/drop column, rename/drop table, type change, `SET NOT NULL`.
- Scanner flags affected code with a confidence level (high / medium / low).
- Demo: renaming `users.full_name` flags 3 queries (high) and 2 DTO lines (medium). Dropping `users.legacy_score` flags 1 query.
- Tricky bit: `u.full_name` only makes sense once you know `u` is `users`. For now aliases are resolved within ±6 lines.
- Next: resolve aliases across the whole SQL statement instead of a line window.
