import { db } from '../db';

export async function findUserById(id: string) {
  const { rows } = await db.query(
    `SELECT id, email, full_name
       FROM users
      WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function searchUsers(term: string) {
  return db.query('SELECT id, full_name FROM users WHERE full_name ILIKE $1', [`%${term}%`]);
}

export async function topUsers() {
  return db.query('SELECT id, email FROM users ORDER BY legacy_score DESC LIMIT 10');
}
