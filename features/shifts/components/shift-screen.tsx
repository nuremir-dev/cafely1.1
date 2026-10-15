"use client";

import { useCallback, useEffect, useState } from "react";

import { formatSom } from "@/features/cart/cart";
import type { CashShift, ShiftDashboard } from "@/features/shifts/types";

export function ShiftScreen() {
  const [selectedDate, setSelectedDate] = useState("");
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
  const [closeName, setCloseName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date: string) => {
    setIsLoading(true);
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const response = await fetch(`/api/shifts${query}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isShiftDashboardResponse(payload)) throw new Error(readError(payload));
      setShifts(payload.data.shifts);
      setCurrentShift(payload.data.currentShift);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить смены.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(selectedDate), 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedDate]);

  async function closeShift() {
    if (!currentShift || !closeName.trim() || isClosing) {
      if (!closeName.trim()) setError("Введите имя сотрудника, который закрывает смену.");
      return;
    }
    setIsClosing(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId: currentShift.id, closedBy: closeName }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isCashShiftResponse(payload)) throw new Error(readError(payload));
      setCloseName("");
      await load(selectedDate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось закрыть смену.");
    } finally {
      setIsClosing(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section>
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">Смены</h1>
          <p className="mt-1 text-sm text-slate-600">Открытие, закрытие и итоги кассовых смен.</p>
        </header>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        <label className="mb-4 block max-w-xs text-sm font-semibold text-slate-700">
          День смены
          <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-primary" />
        </label>
        {selectedDate && <button type="button" onClick={() => setSelectedDate("")} className="mb-4 text-sm font-semibold text-primary-strong underline">Показать все смены</button>}
        {isLoading ? <p className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow-sm">Загрузка смен…</p> : shifts.length === 0 ? <p className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow-sm">За выбранный день смен нет.</p> : <div className="space-y-6">{groupShiftsByDate(shifts).map(([businessDate, dateShifts]) => <section key={businessDate}><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-bold text-slate-900">{formatDate(businessDate)}</h2><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-primary-strong">{dateShifts.length} {pluralShifts(dateShifts.length)}</span></div><ul className="space-y-3">{dateShifts.map((shift) => <ShiftCard key={shift.id} shift={shift} />)}</ul></section>)}</div>}
      </section>
      <aside className="xl:sticky xl:top-5 xl:self-start">
        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Закрытие смены</h2>
          {!currentShift ? <p className="mt-3 text-sm leading-6 text-slate-600">Сегодня открытой смены нет. Откройте её на экране «Продажа».</p> : <>
            <p className="mt-3 text-sm text-slate-600">Открыта {formatDateTime(currentShift.openedAt)}: {currentShift.openedBy}.</p>
            <label className="mt-5 block text-sm font-semibold text-slate-700">Кто закрывает смену<input value={closeName} onChange={(event) => setCloseName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void closeShift(); }} maxLength={100} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-primary" placeholder="Имя сотрудника" /></label>
            <button type="button" onClick={() => void closeShift()} disabled={isClosing} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{isClosing ? "Закрываем…" : "Закрыть смену"}</button>
            <p className="mt-3 text-xs leading-5 text-slate-500">Смена не закроется, пока в ней есть незавершённые заказы.</p>
          </>}
        </div>
      </aside>
    </div>
  );
}

function ShiftCard({ shift }: { shift: CashShift }) {
  return <li className="rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mt-1 text-sm text-slate-600">Открыл(а): {shift.openedBy} · {formatDateTime(shift.openedAt)}</p><p className="mt-1 text-sm text-slate-600">{shift.closedAt ? <>Закрыл(а): {shift.closedBy} · {formatDateTime(shift.closedAt)}</> : "Смена ещё открыта"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${shift.status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{shift.status === "open" ? "Открыта" : "Закрыта"}</span></div><div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm"><div><span className="block text-slate-500">Продажи</span><strong className="text-lg text-primary-strong">{formatSom(shift.salesTotalTyiyn)}</strong></div><div><span className="block text-slate-500">Продано блюд</span><strong className="text-lg">{shift.soldItemCount}</strong></div></div></li>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "long" }).format(new Date(`${value}T00:00:00+06:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function groupShiftsByDate(shifts: CashShift[]) { const groups = new Map<string, CashShift[]>(); for (const shift of shifts) groups.set(shift.businessDate, [...(groups.get(shift.businessDate) ?? []), shift]); return [...groups.entries()]; }
function pluralShifts(count: number) { const last = count % 10; const lastTwo = count % 100; return last === 1 && lastTwo !== 11 ? "смена" : last >= 2 && last <= 4 && (lastTwo < 10 || lastTwo >= 20) ? "смены" : "смен"; }
function isShiftDashboardResponse(value: unknown): value is { data: ShiftDashboard } { return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "currentShift" in value.data && "shifts" in value.data); }
function isCashShiftResponse(value: unknown): value is { data: CashShift } { return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "businessDate" in value.data); }
function readError(value: unknown) { return value && typeof value === "object" && "error" in value && value.error && typeof value.error === "object" && "message" in value.error && typeof value.error.message === "string" ? value.error.message : "Не удалось выполнить действие со сменой."; }
