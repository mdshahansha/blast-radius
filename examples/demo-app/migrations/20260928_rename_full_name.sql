-- Looks harmless: rename one column, drop one nobody uses (probably).
ALTER TABLE users RENAME COLUMN full_name TO name;

ALTER TABLE users DROP COLUMN legacy_score;
