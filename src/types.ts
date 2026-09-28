/** How sure we are that a code location is affected by a schema change. */
export type Confidence = 'high' | 'medium' | 'low';

/** A breaking change removes or renames something code depends on; a risky one may still break writes or casts. */
export type Risk = 'breaking' | 'risky';

export type SchemaChange =
  | { kind: 'rename_column'; table: string; column: string; to: string }
  | { kind: 'drop_column'; table: string; column: string }
  | { kind: 'alter_column_type'; table: string; column: string; newType: string }
  | { kind: 'set_not_null'; table: string; column: string }
  | { kind: 'rename_table'; table: string; to: string }
  | { kind: 'drop_table'; table: string };

/** A schema change plus where it was found in the migration. */
export interface LocatedChange {
  id: string;
  change: SchemaChange;
  risk: Risk;
  source: { file: string; line: number; statement: string };
}

export interface Finding {
  changeId: string;
  file: string;
  line: number;
  snippet: string;
  confidence: Confidence;
  reason: string;
}

export interface Analysis {
  changes: LocatedChange[];
  findings: Finding[];
  filesScanned: number;
}
