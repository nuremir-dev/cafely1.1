"use client";

import { useState } from "react";

import type { TableMap } from "@/features/tables/server/table-map";
import { TableGrid } from "./table-grid";

export function TableMapEditor({ initialMap }: { initialMap: TableMap }) {
  const [cells, setCells] = useState(initialMap.cells);
  const [rows, setRows] = useState(initialMap.rows);
  const [columns, setColumns] = useState(initialMap.columns);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(cell: number) {
    setCells((current) => current.includes(cell) ? current.filter((value) => value !== cell) : current.length < 12 ? [...current, cell] : current);
  }
  async function save() {
    setSaving(true); setStatus(null);
    try {
      const response = await fetch("/api/table-map", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cells, rows, columns }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось сохранить карту.");
      setStatus("Карта столов сохранена.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Не удалось сохранить карту."); } finally { setSaving(false); }
  }

  function setDimensions(nextRows: number, nextColumns: number) { setRows(nextRows); setColumns(nextColumns); setCells((current) => current.filter((cell) => cell < nextRows * nextColumns)); }
  return <section className="max-w-3xl rounded-2xl border border-border bg-surface p-5"><h1 className="text-2xl font-bold">Карта столов</h1><p className="mt-2 text-sm text-slate-600">Выберите размер карты, затем нажимайте клетки по порядку: первая станет столом 1, следующая — столом 2.</p><div className="mt-4 flex gap-3"><label className="grid gap-1 text-sm font-medium">Строки<select value={rows} onChange={(event) => setDimensions(Number(event.target.value), columns)} className="rounded-lg border border-border bg-white px-3 py-2">{[3,4,5,6,7,8,9,10,11,12].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Колонки<select value={columns} onChange={(event) => setDimensions(rows, Number(event.target.value))} className="rounded-lg border border-border bg-white px-3 py-2">{[3,4,5,6,7,8,9,10,11,12].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="mt-5 max-w-xl"><TableGrid cells={cells} rows={rows} columns={columns} onToggle={toggle} /></div><div className="mt-5 flex items-center gap-3"><button type="button" onClick={() => void save()} disabled={saving || cells.length === 0} className="rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Сохраняем…" : "Сохранить карту"}</button><button type="button" onClick={() => setCells([])} className="text-sm text-slate-500 underline">Очистить</button>{status && <p className="text-sm text-slate-600">{status}</p>}</div></section>;
}
