export interface UserRow {
  id: string;
  email: string;
  full_name: string;
}

// Shape returned by GET /users/:id
export function toUserResponse(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
  };
}
