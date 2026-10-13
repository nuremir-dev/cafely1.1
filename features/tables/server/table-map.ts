import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/http/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const dimensionSchema = z.int().min(3).max(12);
const cellsSchema = z.array(z.int().min(0).max(143)).min(1).max(12).refine((cells) => new Set(cells).size === cells.length);

export type TableMap = { cells: number[]; rows: number; columns: number };

export async function getTableMap(): Promise<TableMap> {
  const { data, error } = await createSupabaseAdminClient().from("table_maps").select("cells, rows, columns").eq("id", true).maybeSingle();
  if (error) throw error;
  const parsed = cellsSchema.safeParse(data?.cells);
  const rows = dimensionSchema.safeParse(data?.rows).data ?? 6;
  const columns = dimensionSchema.safeParse(data?.columns).data ?? 8;
  const fallback = Array.from({ length: 12 }, (_, index) => index);
  return { cells: parsed.success ? parsed.data.filter((cell) => cell < rows * columns) : fallback, rows, columns };
}

export async function saveTableMap(input: unknown): Promise<TableMap> {
  const parsed = z.object({ cells: cellsSchema, rows: dimensionSchema, columns: dimensionSchema }).safeParse(input);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", 400, "Выберите от 1 до 12 разных клеток для столов.");
  if (parsed.data.cells.some((cell) => cell >= parsed.data.rows * parsed.data.columns)) throw new ApiError("INVALID_REQUEST", 400, "Выбранная клетка находится за пределами сетки.");
  const { error } = await createSupabaseAdminClient().from("table_maps").upsert({ id: true, cells: parsed.data.cells, rows: parsed.data.rows, columns: parsed.data.columns, updated_at: new Date().toISOString() });
  if (error) throw error;
  return parsed.data;
}
