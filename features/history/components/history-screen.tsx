"use client";

import { useCallback, useEffect, useState } from "react";

import { formatSom } from "@/features/cart/cart";
import type { HistoryOrder, HistoryPage, OrderDetails } from "@/features/history/types";
import type { PrintJob } from "@/features/orders/types";
import { printOrder } from "@/features/printing/qz-client";

type HistoryResponse = { data: HistoryPage };
type DetailsResponse = { data: OrderDetails };

export function HistoryScreen() {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPage = useCallback(async (cursor: string | null, append: boolean) => {
    try {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      const query = new URLSearchParams({ limit: "25" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/orders?${query.toString()}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isHistoryResponse(payload)) throw new Error(readErrorMessage(payload));
      setOrders((current) => append ? [...current, ...payload.data.orders] : payload.data.orders);
      setNextCursor(payload.data.nextCursor);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить историю продаж.");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(null, false), 0);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  async function openOrder(id: string) {
    setIsLoadingDetails(true);
    try {
      const response = await fetch(`/api/orders/${id}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isDetailsResponse(payload)) throw new Error(readErrorMessage(payload));
      setSelectedOrder(payload.data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить заказ.");
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function retryPrint(job: PrintJob) {
    if (!selectedOrder) return;
    const retryOrder = { ...selectedOrder, created: false };
    await printOrder(retryOrder, async (job, status, lastError) => {
      await fetch(`/api/print-jobs/${job.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, lastError: lastError ?? null }) });
      setSelectedOrder((current) => current ? { ...current, printJobs: current.printJobs.map((item) => item.id === job.id ? { ...item, status, lastError: status === "failed" ? lastError ?? "Ошибка печати" : null, attempts: item.attempts + 1 } : item) } : current);
    }, job.type, job.id);
  }

  async function cancelOrder(id: string) {
    setCancellingOrderId(id);
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readErrorMessage(payload));
      setOrders((current) => current.filter((order) => order.id !== id));
      if (selectedOrder?.id === id) setSelectedOrder(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось отменить заказ.");
    } finally {
      setCancellingOrderId(null);
    }
  }

  async function clearHistory() {
    if (!window.confirm("Удалить всю историю заказов без возможности восстановления?")) return;
    setIsClearing(true);
    try {
      const response = await fetch("/api/orders", { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readErrorMessage(payload));
      setOrders([]);
      setNextCursor(null);
      setSelectedOrder(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось очистить историю.");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_27rem]">
      <section aria-labelledby="history-title">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="history-title" className="text-2xl font-bold tracking-tight">История продаж</h1>
            <p className="mt-1 text-sm text-slate-600">Завершённые заказы: новые сверху.</p>
          </div>
          {orders.length > 0 && <button type="button" onClick={() => void clearHistory()} disabled={isClearing} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">{isClearing ? "Очищаем…" : "Очистить историю"}</button>}
        </header>
        {errorMessage && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{errorMessage}</p>}
        {isLoading ? <p className="rounded-xl bg-surface p-5 text-slate-600">Загрузка истории…</p> : (
          <>
            {orders.length === 0 ? <p className="rounded-xl bg-surface p-5 text-slate-600">Продаж пока нет.</p> : (
              <ul className="overflow-hidden rounded-2xl border border-border bg-surface">
                {orders.map((order) => (
                  <li key={order.id} className="border-b border-border last:border-0">
                    <div className="flex items-center gap-2 p-4">
                      <button type="button" onClick={() => void openOrder(order.id)} className="grid min-w-0 flex-1 gap-2 text-left hover:text-primary-strong sm:grid-cols-[7rem_1fr_auto] sm:items-center">
                        <span className="font-bold">№{order.orderNumber}</span>
                        <span className="text-sm text-slate-600">{formatDateTime(order.createdAt)} · {order.itemCount} шт. · {order.cashierName}</span>
                        <span className="font-bold text-primary-strong">{formatSom(order.totalTyiyn)}</span>
                      </button>
                      <button type="button" onClick={() => void cancelOrder(order.id)} disabled={cancellingOrderId === order.id} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{cancellingOrderId === order.id ? "Отмена…" : "Отменить"}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor && <button type="button" disabled={isLoadingMore} onClick={() => void loadPage(nextCursor, true)} className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 font-semibold disabled:opacity-50">{isLoadingMore ? "Загрузка…" : "Показать ещё"}</button>}
          </>
        )}
      </section>

      <aside className="xl:sticky xl:top-5 xl:self-start" aria-live="polite">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-xl font-bold">Состав заказа</h2>
          {isLoadingDetails && <p className="py-8 text-sm text-slate-600">Загрузка заказа…</p>}
          {!isLoadingDetails && !selectedOrder && <p className="py-8 text-sm text-slate-600">Выберите заказ, чтобы посмотреть состав и состояние печати.</p>}
          {!isLoadingDetails && selectedOrder && <OrderDetailView order={selectedOrder} onRetry={retryPrint} />}
        </div>
      </aside>
    </div>
  );
}

function OrderDetailView({ order, onRetry }: { order: OrderDetails; onRetry: (job: PrintJob) => Promise<void> }) {
  return <div className="mt-5 space-y-5"><div className="text-sm text-slate-600"><p><strong className="text-foreground">Заказ №{order.orderNumber}</strong></p><p>{formatDateTime(order.createdAt)}</p><p>{order.cashierName}</p></div><ul className="divide-y divide-border border-y border-border">{order.items.map((item) => <li key={item.menuItemId} className="flex justify-between gap-3 py-3"><span>{item.itemName} × {item.quantity}<small className="mt-1 block text-slate-500">{formatSom(item.unitPriceTyiyn)} за шт.</small></span><strong className="whitespace-nowrap">{formatSom(item.lineTotalTyiyn)}</strong></li>)}</ul><div className="flex justify-between text-lg font-bold"><span>Итого</span><span className="text-primary-strong">{formatSom(order.totalTyiyn)}</span></div><div><h3 className="font-semibold">Печать</h3><ul className="mt-2 space-y-2">{order.printJobs.map((job) => <li key={job.id} className="rounded-lg bg-surface-muted p-3 text-sm"><p><strong>{job.type === "customer" ? "Квитанция посетителя" : "Кухонный чек"}</strong>: {printStatus(job.status)}</p>{job.lastError && <p className="mt-1 text-red-700">Ошибка: {job.lastError}</p>}{job.status === "failed" && <button type="button" onClick={() => void onRetry(job)} className="mt-2 underline">Повторить печать</button>}</li>)}</ul></div></div>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function printStatus(status: "pending" | "processing" | "submitted" | "failed"): string {
  return { pending: "ожидает печатную станцию", processing: "печатается", submitted: "передан на печать", failed: "ошибка печати" }[status];
}

function isHistoryResponse(payload: unknown): payload is HistoryResponse {
  return Boolean(payload && typeof payload === "object" && "data" in payload);
}

function isDetailsResponse(payload: unknown): payload is DetailsResponse {
  return Boolean(payload && typeof payload === "object" && "data" in payload);
}

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "Не удалось загрузить данные.";
  const error = payload.error;
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Не удалось загрузить данные.";
}
