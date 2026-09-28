// Stand-in for a real database client so the demo reads like an app.
export const db = {
  async query(sql: string, params: unknown[] = []) {
    return { rows: [] as any[], sql, params };
  },
};
