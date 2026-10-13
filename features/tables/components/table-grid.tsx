type TableGridProps = {
  cells: number[];
  rows: number;
  columns: number;
  freeTables?: number[];
  onSelect?: (table: number) => void;
  onToggle?: (cell: number) => void;
};

export function TableGrid({ cells, rows, columns, freeTables, onSelect, onToggle }: TableGridProps) {
  return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
    {Array.from({ length: rows * columns }, (_, cell) => {
      const table = cells.indexOf(cell) + 1;
      if (onToggle) return <button key={cell} type="button" onClick={() => onToggle(cell)} className={`aspect-square rounded-md border text-xs font-bold transition ${table ? "border-primary bg-teal-50 text-primary-strong" : "border-slate-200 bg-white text-slate-300 hover:border-primary"}`}>{table || ""}</button>;
      if (!table) return <span key={cell} className="aspect-square rounded-md bg-slate-50" />;
      const free = freeTables?.includes(table) ?? false;
      return <button key={cell} type="button" disabled={!free} onClick={() => onSelect?.(table)} className={`aspect-square rounded-md text-xs font-bold ${free ? "bg-teal-50 text-primary-strong hover:bg-primary hover:text-white" : "bg-slate-100 text-slate-300"}`}>{table}</button>;
    })}
  </div>;
}
