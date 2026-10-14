"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatSom } from "@/features/cart/cart";
import type { MenuCatalog } from "@/features/menu/types";
import type { CreatedOrder } from "@/features/orders/types";
import type { ActiveOrder, ActiveOrderSummary } from "@/features/orders/server/active-orders";
import { printOrder } from "@/features/printing/qz-client";
import { TableGrid } from "@/features/tables/components/table-grid";

type MenuResponse = { data: MenuCatalog };
type ActiveOrdersResponse = { data: ActiveOrderSummary[] };
type ActiveOrderResponse = { data: ActiveOrder };
type PrintableResponse = { data: CreatedOrder };
type TableMapResponse = { data: { cells: number[]; rows: number; columns: number } };
type MenuItem = MenuCatalog["categories"][number]["items"][number];
type SelectedMenuItem = MenuItem & { selectedVariantId: string | null; displayName: string };

export function PosScreen() {
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [orders, setOrders] = useState<ActiveOrderSummary[]>([]);
  const [active, setActive] = useState<ActiveOrder | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [tableMap, setTableMap] = useState({ cells: Array.from({ length: 12 }, (_, index) => index), rows: 6, columns: 8 });
  const itemQueue = useRef(Promise.resolve());
  const itemVersion = useRef(0);
  const activeOrderRevision = useRef(0);

  const loadOrder = useCallback(async (id: string, revision = activeOrderRevision.current) => {
    const response = await fetch(`/api/active-orders/${id}`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось загрузить заказ."));
    if (revision === activeOrderRevision.current) setActive(payload.data);
  }, []);
  const loadOrders = useCallback(async (preferredId?: string | null) => {
    const revision = activeOrderRevision.current;
    const response = await fetch("/api/active-orders", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isActiveOrdersResponse(payload)) throw new Error(message(payload, "Не удалось загрузить активные заказы."));
    if (revision !== activeOrderRevision.current) return;
    setOrders(payload.data);
    const id = preferredId && payload.data.some((order) => order.id === preferredId) ? preferredId : payload.data[0]?.id;
    if (id) await loadOrder(id, revision); else setActive(null);
  }, [loadOrder]);
  const loadMenu = useCallback(async () => {
    const response = await fetch("/api/menu", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isMenuResponse(payload)) throw new Error(message(payload, "Не удалось загрузить меню."));
    setCatalog(payload.data);
  }, []);
  const loadTableMap = useCallback(async () => {
    const response = await fetch("/api/table-map", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isTableMapResponse(payload)) throw new Error(message(payload, "Не удалось загрузить карту столов."));
    setTableMap(payload.data);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void Promise.all([loadMenu(), loadOrders(), loadTableMap()]).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить POS.")), 0);
    return () => window.clearTimeout(timer);
  }, [loadMenu, loadOrders, loadTableMap]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const menuItems = useMemo(() => {
    if (!catalog) return [];
    const term = query.trim().toLocaleLowerCase("ru-RU");
    return catalog.categories.flatMap((category) => category.items.filter((item) => (categoryId === null || categoryId === item.categoryId) && (!term || item.name.toLocaleLowerCase("ru-RU").includes(term))));
  }, [catalog, categoryId, query]);
  const freeTables = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1).filter((table) => !orders.some((order) => order.tableNumber === table)), [orders]);
  const hasPending = active?.items.some((item) => item.fulfillmentType === "kitchen" && item.quantity > item.sentQuantity) ?? false;

  async function createOrder() {
    if (isCreating) return;
    activeOrderRevision.current += 1;
    setIsCreating(true); setNotice(null); setShowTables(false);
    try {
      const response = await fetch("/api/active-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось открыть новый заказ."));
      setActive(payload.data);
      setOrders((current) => [toActiveOrderSummary(payload.data), ...current.filter((order) => order.id !== payload.data.id)]);
      setNotice("Новый заказ открыт."); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть новый заказ."); } finally { setIsCreating(false); }
  }
  async function selectOrder(id: string) { if (isTransitioning) return; const revision = ++activeOrderRevision.current; setIsTransitioning(true); try { await loadOrder(id, revision); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть заказ."); } finally { setIsTransitioning(false); } }
  async function assignTable(tableNumber: number) {
    if (!active || isTransitioning) return;
    activeOrderRevision.current += 1;
    setIsTransitioning(true); setShowTables(false);
    try {
      const response = await fetch(`/api/active-orders/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "move-table", tableNumber }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось назначить стол."));
      await loadOrders(payload.data.id); setNotice(`Заказ назначен на стол ${tableNumber}.`); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось назначить стол."); } finally { setIsTransitioning(false); }
  }
  function addItem(item: MenuItem, variant?: MenuItem["variants"][number]) {
    if (!active) return;
    queueItemChange(active.id, selectMenuItem(item, variant), 1);
  }
  function subtractItem(item: ActiveOrder["items"][number]) { if (!active) return; queueItemChange(active.id, selectOrderItem(item), -1); }
  async function removeItem(item: ActiveOrder["items"][number]) {
    if (!active || isTransitioning) return;
    if (item.sentQuantity === 0) {
      queueItemChange(active.id, selectOrderItem(item), -item.quantity);
      return;
    }
    const confirmed = window.confirm(`Блюдо «${item.itemName}» уже отправлено на кухню. Удалить его из заказа? Чек об отмене на кухню не будет напечатан.`);
    if (!confirmed) return;
    const orderId = active.id;
    activeOrderRevision.current += 1;
    setIsTransitioning(true); setNotice(null);
    try {
      const response = await fetch(`/api/active-orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel-item", orderItemId: item.id }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "Не удалось удалить блюдо из заказа."));
      await loadOrders(orderId); setNotice(`${item.itemName} удалено из заказа.`); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить блюдо из заказа."); } finally { setIsTransitioning(false); }
  }
  function queueItemChange(orderId: string, item: SelectedMenuItem, delta: number) {
    const version = ++itemVersion.current;
    applyOptimisticItemChange(orderId, item, delta);
    itemQueue.current = itemQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/active-orders/${orderId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-item", menuItemId: item.id, menuItemVariantId: item.selectedVariantId, delta }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось сохранить блюдо."));
      if (version === itemVersion.current) setActive((current) => current?.id === orderId ? payload.data : current);
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, totalTyiyn: payload.data.totalTyiyn } : order));
    }).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : "Не удалось сохранить блюдо."); void loadOrders(orderId); });
  }
  function applyOptimisticItemChange(orderId: string, item: SelectedMenuItem, delta: number) {
    setActive((current) => {
      if (!current || current.id !== orderId) return current;
      const pendingIndex = current.items.findIndex((line) => line.menuItemId === item.id && line.menuItemVariantId === item.selectedVariantId && line.sentQuantity === 0);
      let items = current.items;
      if (pendingIndex === -1 && delta > 0) items = [{ id: `optimistic-${crypto.randomUUID()}`, menuItemId: item.id, menuItemVariantId: item.selectedVariantId, itemName: item.displayName, unitPriceTyiyn: item.priceTyiyn, quantity: delta, sentQuantity: 0, lineTotalTyiyn: item.priceTyiyn * delta, addedAt: new Date().toISOString(), fulfillmentType: item.fulfillmentType }, ...items];
      else if (pendingIndex >= 0) {
        const line = items[pendingIndex]; const quantity = line.quantity + delta;
        if (quantity <= 0) items = items.filter((_, index) => index !== pendingIndex);
        else items = items.map((entry, index) => index === pendingIndex ? { ...entry, quantity, lineTotalTyiyn: entry.unitPriceTyiyn * quantity } : entry);
      }
      return { ...current, items, totalTyiyn: Math.max(0, current.totalTyiyn + item.priceTyiyn * delta) };
    });
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, totalTyiyn: Math.max(0, order.totalTyiyn + item.priceTyiyn * delta) } : order));
  }
  async function sendItemToKitchen(item: ActiveOrder["items"][number]) {
    if (!active || item.fulfillmentType !== "kitchen" || item.quantity === item.sentQuantity || isTransitioning) return;
    const orderId = active.id; setIsTransitioning(true); setNotice(null);
    try {
      await itemQueue.current;
      const response = await fetch(`/api/active-orders/${orderId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "send-item-to-kitchen", orderItemId: item.id, idempotencyKey: crypto.randomUUID() }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload)) throw new Error(message(payload, "Не удалось отправить блюдо на кухню."));
      await loadOrders(orderId); setNotice(`${item.itemName} передано на кухню.`); setError(null);
      void printOrder(payload.data, async (job, status, lastError) => { await reportPrint(job.id, status, lastError); setNotice(status === "failed" ? `${item.itemName}: ошибка печати кухни.` : `${item.itemName}: кухонный чек передан на печать.`); }, "kitchen");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить блюдо на кухню."); } finally { setIsTransitioning(false); }
  }
  async function sendAllToKitchen() {
    if (!active || !hasPending || isTransitioning) return;
    const orderId = active.id; setIsTransitioning(true); setNotice(null);
    try {
      await itemQueue.current;
      const response = await fetch(`/api/active-orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send-to-kitchen", idempotencyKey: crypto.randomUUID() }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload)) throw new Error(message(payload, "Не удалось отправить блюда на кухню."));
      await loadOrders(orderId); setNotice("Все новые блюда переданы на кухню одним чеком."); setError(null);
      void printOrder(payload.data, async (job, status, lastError) => {
        await reportPrint(job.id, status, lastError);
        setNotice(status === "failed" ? "Не удалось напечатать общий кухонный чек." : "Общий кухонный чек передан на печать.");
      }, "kitchen");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить блюда на кухню."); } finally { setIsTransitioning(false); }
  }
  async function completeOrder() {
    if (!active || hasPending || active.items.length === 0 || isTransitioning) return;
    activeOrderRevision.current += 1;
    const orderId = active.id; setIsTransitioning(true); setNotice(null);
    try {
      await itemQueue.current;
      const response = await fetch(`/api/active-orders/${orderId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload)) throw new Error(message(payload, "Не удалось завершить заказ."));
      await loadOrders(null); setNotice("Заказ завершён."); setError(null);
      void printOrder(payload.data, async (job, status, lastError) => { await reportPrint(job.id, status, lastError); setNotice(status === "failed" ? "Заказ завершён, но клиентский чек не напечатан." : "Заказ завершён, клиентский чек передан на печать."); }, "customer");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить заказ."); } finally { setIsTransitioning(false); }
  }
  async function deleteEmptyOrder() {
    if (!active || active.items.length > 0 || isTransitioning) return;
    if (!window.confirm("Удалить пустой заказ?")) return;
    const orderId = active.id;
    activeOrderRevision.current += 1;
    setIsTransitioning(true); setNotice(null);
    try {
      const response = await fetch(`/api/active-orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete-empty" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "Не удалось удалить пустой заказ."));
      await loadOrders(null); setNotice("Пустой заказ удалён."); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить пустой заказ."); } finally { setIsTransitioning(false); }
  }

  const pendingCount = active?.items.reduce(
    (sum, item) => sum + (item.fulfillmentType === "kitchen" ? Math.max(0, item.quantity - item.sentQuantity) : 0),
    0,
  ) ?? 0;

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-2 overflow-hidden rounded-2xl border border-white/80 bg-white/90 p-2 shadow-[0_8px_24px_rgba(56,72,65,0.07)] backdrop-blur-xl">
        <button type="button" onClick={() => void createOrder()} disabled={isCreating} className="shrink-0 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-white shadow-[0_6px_14px_rgba(17,170,160,0.18)] disabled:opacity-50">
            {isCreating ? "Создаём…" : "+ Новый заказ"}
        </button>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5 pr-0.5">
          {orders.map((order) => (
            <button key={order.id} type="button" onClick={() => void selectOrder(order.id)} disabled={isTransitioning} className={`min-w-24 rounded-xl border px-3 py-2 text-left text-sm transition ${active?.id === order.id ? "border-primary bg-teal-50" : "border-slate-200 bg-white hover:border-primary"}`}>
              <strong className="block text-slate-900">{orderTitle(order)}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="pointer-events-none fixed right-4 top-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {error && <Toast kind="error" onClose={() => setError(null)}>{error}</Toast>}
        {notice && <Toast kind="success" onClose={() => setNotice(null)}>{notice}</Toast>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.03fr)_minmax(28rem,.97fr)]">
        <section className="min-w-0 rounded-[1.7rem] border border-white/80 bg-white/90 p-4 shadow-[0_10px_34px_rgba(56,72,65,0.08)] backdrop-blur-xl sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-[-0.04em] text-slate-950">Каталог блюд</h2>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary sm:w-56" />
          </div>
          {catalog && <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            <CategoryButton active={categoryId === null} onClick={() => setCategoryId(null)}>Все</CategoryButton>
            {catalog.categories.map((category) => <CategoryButton key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</CategoryButton>)}
          </div>}
          {!catalog ? <p className="rounded-xl bg-surface-muted p-5 text-slate-600">Загрузка меню…</p> : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {menuItems.map((item) => {
              const hasVariants = item.variants.length > 0;
              const expanded = expandedItemId === item.id;
              return <div key={item.id} className={`min-h-22 rounded-xl border border-slate-200 bg-white p-3 text-left transition ${hasVariants ? "" : "hover:-translate-y-px hover:border-primary hover:bg-teal-50"} ${!active ? "cursor-not-allowed opacity-40" : ""}`}>
                <button type="button" onClick={() => hasVariants ? setExpandedItemId((current) => current === item.id ? null : item.id) : addItem(item)} disabled={!active} aria-expanded={hasVariants ? expanded : undefined} className="block w-full text-left disabled:cursor-not-allowed">
                  <span className="block font-semibold text-slate-900">{item.name}</span>
                  {hasVariants ? <span className="mt-2 block text-sm font-semibold text-primary-strong">Выбрать вариант {expanded ? "⌃" : "⌄"}</span> : <span className="mt-2 block text-base font-bold text-primary-strong">{formatSom(item.priceTyiyn)}</span>}
                </button>
                {hasVariants && expanded && <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3">{item.variants.map((variant) => <button type="button" key={variant.id} onClick={() => addItem(item, variant)} disabled={!active} className="rounded-lg bg-teal-50 px-2.5 py-2 text-left text-xs font-semibold text-primary-strong transition hover:bg-teal-100 disabled:cursor-not-allowed"><span className="block truncate">{variant.name}</span><span className="mt-0.5 block text-sm font-bold">{formatSom(variant.priceTyiyn)}</span></button>)}</div>}
              </div>;
            })}
          </div>}
          {!active && <p className="mt-5 text-sm text-slate-500">Нажмите «Новый заказ», затем сразу добавляйте блюда.</p>}
        </section>
        <aside className="min-w-0 xl:sticky xl:top-3 xl:self-start">
          <div className="flex max-h-[calc(100dvh-8.5rem)] flex-col rounded-[1.7rem] border border-white/80 bg-white/90 p-4 shadow-[0_10px_34px_rgba(56,72,65,0.08)] backdrop-blur-xl sm:p-5">
            <div className="relative shrink-0 border-b border-slate-100 pb-3">
              <button type="button" onClick={() => setShowTables((value) => !value)} disabled={!active || isTransitioning} className="flex items-center gap-2 text-left text-xl font-bold tracking-[-0.04em] text-slate-950 disabled:opacity-50">
                {active ? activeTitle(active) : "Активный заказ"}<span className="text-base text-primary">⌄</span>
              </button>
              {active && <p className="mt-1 text-sm text-slate-500">Заказ №{active.orderNumber} · открыт</p>}
              {showTables && <TableMap map={tableMap} freeTables={freeTables} onSelect={assignTable} />}
            </div>
            {!active ? <p className="py-16 text-center text-sm text-slate-500">Выберите или создайте новый заказ</p> : <>
              <ul className="my-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {active.items.length === 0 ? <li className="py-10 text-center text-sm text-slate-500">Добавьте блюда из каталога</li> : active.items.map((item) => <OrderCard key={item.id} item={item} disabled={isTransitioning} onDecrease={() => subtractItem(item)} onIncrease={() => { if (active) queueItemChange(active.id, selectOrderItem(item), 1); }} onRemove={() => void removeItem(item)} onSend={() => void sendItemToKitchen(item)} />)}
              </ul>
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                <div><span className="block text-slate-500">Новых позиций</span><strong className="text-lg">{pendingCount}</strong></div>
                <div><span className="block text-slate-500">Сумма заказа</span><strong className="text-lg">{formatSom(active.totalTyiyn)}</strong></div>
              </div>
              {hasPending && <button type="button" onClick={() => void sendAllToKitchen()} disabled={isTransitioning} className="mt-4 w-full rounded-2xl border border-primary bg-teal-50 px-4 py-3 text-sm font-bold text-primary-strong hover:bg-teal-100 disabled:opacity-40">Отправить всё на кухню одним чеком</button>}
              {active.items.length === 0 ? <button type="button" onClick={() => void deleteEmptyOrder()} disabled={isTransitioning} className="mt-4 w-full rounded-2xl bg-red-500 px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(239,68,68,0.2)] hover:bg-red-600 disabled:opacity-40">Удалить заказ</button> : <button type="button" onClick={() => void completeOrder()} disabled={hasPending || isTransitioning} className="mt-4 w-full rounded-2xl bg-primary px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(17,170,160,0.2)] disabled:opacity-40">Завершить заказ</button>}
              {hasPending && <p className="mt-3 text-center text-xs text-amber-700">Отправьте каждое новое блюдо на кухню перед завершением.</p>}
            </>}
          </div>
        </aside>
      </div>
    </div>
  );
}

type OrderCardProps = {
  item: ActiveOrder["items"][number];
  disabled: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onRemove: () => void;
  onSend: () => void;
};

function OrderCard({ item, disabled, onDecrease, onIncrease, onRemove, onSend }: OrderCardProps) {
  const requiresKitchen = item.fulfillmentType === "kitchen";
  const pending = requiresKitchen ? item.quantity - item.sentQuantity : 0;

  return <li className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 pr-10 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(8rem,auto)_auto]">
    <button type="button" onClick={onRemove} disabled={disabled} aria-label={`Удалить ${item.itemName} из заказа`} className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-35">×</button>
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-400">Блюдо</p>
      <h3 className="truncate font-bold">{item.itemName}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{formatSom(item.unitPriceTyiyn)} × {item.quantity}</p>
    </div>
    <div className="text-right sm:text-left">
      <p className="text-[11px] font-medium text-slate-400">Сумма</p>
      <p className="font-bold text-slate-800">{formatSom(item.lineTotalTyiyn)}</p>
    </div>
    <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:block">
      <p className="text-[11px] font-medium text-slate-400">Статус</p>
      {!requiresKitchen ? <span className="mt-1 inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">{fulfillmentLabel(item.fulfillmentType)}</span> : pending > 0 ? <div className="mt-1 flex items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-xl border border-slate-200">
        <QuantityButton label={`Уменьшить ${item.itemName}`} disabled={disabled} onClick={onDecrease}>−</QuantityButton>
        <span className="grid min-w-10 place-items-center font-bold">{item.quantity}</span>
        <QuantityButton label={`Увеличить ${item.itemName}`} disabled={disabled} onClick={onIncrease}>+</QuantityButton>
        </div>
        <button type="button" onClick={onSend} disabled={disabled} className="rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-40">На кухню</button>
      </div> : <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">✓ На кухне</span>}
    </div>
    <div className="col-span-2 text-right sm:col-span-1 sm:text-left">
      <p className="text-[11px] font-medium text-slate-400">Время</p>
      <p className="text-sm font-medium text-slate-600">{formatOrderTime(item.addedAt)}</p>
    </div>
  </li>;
}

function TableMap({ map, freeTables, onSelect }: { map: TableMapResponse["data"]; freeTables: number[]; onSelect: (table: number) => void }) {
  return <div className="absolute left-0 top-full z-20 mt-2 w-[min(24rem,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"><p className="mb-2 text-xs text-slate-500">Выберите свободный стол</p><TableGrid cells={map.cells} rows={map.rows} columns={map.columns} freeTables={freeTables} onSelect={onSelect} />
  </div>;
}

function CategoryButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  const style = active ? "bg-primary text-white" : "bg-surface-muted text-slate-700 hover:bg-teal-100";
  return <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${style}`}>{children}</button>;
}

function QuantityButton({ children, disabled, label, onClick }: { children: string; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid size-10 place-items-center text-lg font-bold text-primary hover:bg-teal-50 disabled:opacity-35">{children}</button>;
}

function Toast({ children, kind, onClose }: { children: string; kind: "success" | "error"; onClose: () => void }) {
  const style = kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-white text-teal-900";
  const iconStyle = kind === "error" ? "bg-red-500 text-white" : "bg-primary text-white";

  return <div role={kind === "error" ? "alert" : "status"} className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl transition-all duration-300 ease-out ${style}`}>
    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${iconStyle}`}>{kind === "error" ? "!" : "✓"}</span>
    <p className="flex-1 text-sm font-medium leading-5">{children}</p>
    <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100" aria-label="Закрыть уведомление">×</button>
  </div>;
}
function orderTitle(order: ActiveOrderSummary) { return order.tableNumber ? `Стол ${order.tableNumber}` : "Новый заказ"; }
function activeTitle(order: ActiveOrder) { return order.tableNumber ? `Стол ${order.tableNumber}` : "Новый заказ"; }
function selectMenuItem(item: MenuItem, variant?: MenuItem["variants"][number]): SelectedMenuItem {
  return { ...item, priceTyiyn: variant?.priceTyiyn ?? item.priceTyiyn, selectedVariantId: variant?.id ?? null, displayName: variant ? `${item.name} · ${variant.name}` : item.name };
}
function selectOrderItem(item: ActiveOrder["items"][number]): SelectedMenuItem {
  return { id: item.menuItemId, categoryId: "", name: item.itemName, priceTyiyn: item.unitPriceTyiyn, fulfillmentType: item.fulfillmentType, variants: [], selectedVariantId: item.menuItemVariantId, displayName: item.itemName };
}
function fulfillmentLabel(type: ActiveOrder["items"][number]["fulfillmentType"]) { return type === "counter" ? "Витрина" : "Напиток"; }
function toActiveOrderSummary(order: ActiveOrder): ActiveOrderSummary { return { id: order.id, orderNumber: order.orderNumber, tableNumber: order.tableNumber, totalTyiyn: order.totalTyiyn, cashierName: order.cashierName, createdAt: order.createdAt }; }
function formatOrderTime(value: string) { return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(new Date(value)); }
async function reportPrint(id: string, status: "submitted" | "failed", lastError?: string) { await fetch(`/api/print-jobs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, lastError: lastError ?? null }) }); }
function isMenuResponse(value: unknown): value is MenuResponse { return Boolean(value && typeof value === "object" && "data" in value); }
function isActiveOrdersResponse(value: unknown): value is ActiveOrdersResponse { return Boolean(value && typeof value === "object" && "data" in value && Array.isArray(value.data)); }
function isActiveOrderResponse(value: unknown): value is ActiveOrderResponse { return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "tableNumber" in value.data); }
function isPrintableResponse(value: unknown): value is PrintableResponse { return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "printJobs" in value.data); }
function isTableMapResponse(value: unknown): value is TableMapResponse { return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "cells" in value.data && Array.isArray(value.data.cells)); }
function message(value: unknown, fallback: string) { if (!value || typeof value !== "object" || !("error" in value) || !value.error || typeof value.error !== "object" || !("message" in value.error) || typeof value.error.message !== "string") return fallback; return value.error.message; }
