import type { ActionTable } from './actionTable.js';

export function ActionTableEditor(props: {
  table: ActionTable;
  onChange: (table: ActionTable) => void;
}) {
  const { table, onChange } = props;
  const setCell = (rowIndex: number, column: number, value: string) => {
    onChange({
      ...table,
      rows: table.rows.map((cells, index) =>
        index === rowIndex ? cells.map((cell, at) => (at === column ? value : cell)) : cells,
      ),
    });
  };
  return (
    <div className="action-editor">
      <table>
        <thead>
          <tr>
            {table.header.map((name) => (
              <th key={name}>{name}</th>
            ))}
            <th>
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, column) => (
                <td key={table.header[column] ?? column}>
                  <input
                    type="text"
                    aria-label={`${table.header[column] ?? ''}, row ${String(rowIndex + 1)}`}
                    value={cell}
                    onChange={(e) => {
                      setCell(rowIndex, column, e.target.value);
                    }}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove row ${String(rowIndex + 1)}`}
                  onClick={() => {
                    onChange({ ...table, rows: table.rows.filter((_, at) => at !== rowIndex) });
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          onChange({ ...table, rows: [...table.rows, table.header.map(() => '')] });
        }}
      >
        Add action item
      </button>
    </div>
  );
}
