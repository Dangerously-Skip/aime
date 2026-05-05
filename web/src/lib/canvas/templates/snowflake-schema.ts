import type { CanvasTemplate } from './types';

interface SnowflakeColumn {
  name: string;
  type: string;
  nullable?: boolean;
  /** Marks this column as part of the table's primary key. */
  primaryKey?: boolean;
  /** Foreign-key target in `OTHER_TABLE.column` form. */
  references?: string;
  /** Optional column comment from `INFORMATION_SCHEMA`. */
  comment?: string;
}

interface SnowflakeTable {
  name: string;
  rowCount?: number;
  comment?: string;
  columns: SnowflakeColumn[];
}

interface SnowflakeSchemaInput {
  database: string;
  schema: string;
  tables: SnowflakeTable[];
  /** Optional caption rendered below the diagram. */
  caption?: string;
}

function sanitizeId(name: string): string {
  // Mermaid erDiagram entity names must be alphanumeric+underscore.
  return name.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}

function buildErDiagram(tables: SnowflakeTable[]): string {
  const lines: string[] = ['erDiagram'];
  for (const t of tables) {
    const id = sanitizeId(t.name);
    lines.push(`  ${id} {`);
    for (const col of t.columns) {
      const flags = [
        col.primaryKey ? 'PK' : '',
        col.references ? 'FK' : '',
      ].filter(Boolean).join(',');
      lines.push(`    ${col.type.replace(/[^A-Za-z0-9_()]/g, '_')} ${col.name.replace(/[^A-Za-z0-9_]/g, '_')}${flags ? ` "${flags}"` : ''}`);
    }
    lines.push('  }');
  }
  // Relationships
  for (const t of tables) {
    for (const col of t.columns) {
      if (!col.references) continue;
      const [otherTable] = col.references.split('.');
      if (!otherTable) continue;
      lines.push(`  ${sanitizeId(t.name)} }o--|| ${sanitizeId(otherTable)} : "${col.name}"`);
    }
  }
  return lines.join('\n');
}

export const snowflakeSchemaTemplate: CanvasTemplate<SnowflakeSchemaInput> = {
  id: 'snowflake_schema',
  name: 'Snowflake schema viewer',
  description: 'Render a Snowflake database schema as an ER diagram (Mermaid) plus per-table column lists. Tables include row counts, primary keys, and foreign-key relationships.',
  whenToUse: 'When the user asks about a Snowflake database schema, table relationships, ER diagram, or wants to explore the warehouse. Use Snowflake MCP tools to query INFORMATION_SCHEMA.TABLES, INFORMATION_SCHEMA.COLUMNS, and any FK metadata available, then call this template. Prefer pulling a small focused set of tables (5–20) over the entire schema.',
  inputShape: '{ database: string, schema: string, tables: { name, rowCount?, comment?, columns: { name, type, nullable?, primaryKey?, references? (in "TABLE.column" form), comment? }[] }[], caption?: string }',
  render: ({ database, schema, tables, caption }) => ({
    version: '1',
    title: `${database}.${schema}`,
    components: [
      {
        type: 'stat',
        id: 'overview',
        stats: [
          { label: 'Database', value: database },
          { label: 'Schema', value: schema },
          { label: 'Tables', value: tables.length },
          {
            label: 'Total rows',
            value: tables.reduce((sum, t) => sum + (t.rowCount ?? 0), 0).toLocaleString(),
          },
        ],
      },
      {
        type: 'mermaid',
        id: 'er',
        title: 'Entity-relationship diagram',
        code: buildErDiagram(tables),
        caption: 'PK = primary key, FK = foreign key',
      },
      ...tables.map((t) => ({
        type: 'table' as const,
        id: `table-${t.name}`,
        title: `${t.name}${t.rowCount !== undefined ? ` (${t.rowCount.toLocaleString()} rows)` : ''}`,
        columns: [
          { key: 'name', label: 'Column' },
          { key: 'type', label: 'Type' },
          { key: 'flags', label: 'Flags', type: 'badge' as const },
          { key: 'comment', label: 'Comment' },
        ],
        rows: t.columns.map((col) => ({
          name: col.name,
          type: col.type,
          flags: [
            col.primaryKey ? 'PK' : '',
            col.references ? `FK→${col.references}` : '',
            col.nullable === false ? 'NOT NULL' : '',
          ].filter(Boolean).join(' · '),
          comment: col.comment ?? '',
        })),
      })),
      ...(caption ? [{ type: 'markdown' as const, id: 'caption', content: caption }] : []),
    ],
  }),
};
