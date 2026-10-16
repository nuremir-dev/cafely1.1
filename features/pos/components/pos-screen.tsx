"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatSom } from "@/features/cart/cart";
import type { MenuCatalog } from "@/features/menu/types";
import type { CreatedOrder } from "@/features/orders/types";
import type {
  ActiveOrder,
  ActiveOrderSummary,
} from "@/features/orders/server/active-orders";
import { calculateCartTotal, findReusableEmptyOrder, readPosCache, type CachedPosOrder, type CompletedPosOrder, type PendingKitchenPrint, writePosCache } from "@/features/pos/local-pos-cache";
import { getPrintStationId, printCustomerReceiptSnapshot, printKitchenReceiptSnapshot } from "@/features/printing/qz-client";
import type { CashShift, ShiftDashboard } from "@/features/shifts/types";
import { TableGrid } from "@/features/tables/components/table-grid";

type MenuResponse = { data: MenuCatalog };
type ActiveOrdersResponse = { data: ActiveOrder[] };
type ActiveOrderResponse = { data: ActiveOrder };
type PrintableResponse = { data: CreatedOrder };
type AutoCloseStaleShiftResponse = {
  data: { outcome: "none" | "closed"; shift: CashShift | null };
};
type TableMapResponse = {
  data: { cells: number[]; rows: number; columns: number };
};
type MenuItem = MenuCatalog["categories"][number]["items"][number];
type SelectedMenuItem = MenuItem & {
  selectedVariantId: string | null;
  serviceLocation?: "hall" | "takeaway";
  displayName: string;
  targetLineId?: string;
  kitchenComment?: string | null;
};
const menuCacheKey = "cafeline:pos-menu:v1";
const menuRevisionKey = "cafeline:menu-revision";
const menuCacheLifetimeMs = 60_000;
const variantButtonStyles = [
  "bg-amber-50 text-amber-950 hover:bg-amber-100",
  "bg-sky-50 text-sky-950 hover:bg-sky-100",
  "bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  "bg-violet-50 text-violet-950 hover:bg-violet-100",
];

export function PosScreen() {
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [orders, setOrders] = useState<ActiveOrderSummary[]>([]);
  const [active, setActive] = useState<CachedPosOrder | null>(null);
  const [cachedOrders, setCachedOrders] = useState<Record<string, CachedPosOrder>>({});
  const [completedOrders, setCompletedOrders] = useState<CompletedPosOrder[]>([]);
  const [cacheReady, setCacheReady] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showKitchenRepeatConfirm, setShowKitchenRepeatConfirm] = useState(false);
  const [kitchenCancellationItem, setKitchenCancellationItem] = useState<ActiveOrder["items"][number] | null>(null);
  const [showUnknownPurchase, setShowUnknownPurchase] = useState(false);
  const [unknownPurchaseAmount, setUnknownPurchaseAmount] = useState("");
  const [variantPicker, setVariantPicker] = useState<{ item: MenuItem } | null>(null);
  const [containerPrompt, setContainerPrompt] = useState<MenuItem | null>(null);
  const [containerPicker, setContainerPicker] = useState<MenuItem | null>(null);
  const [commentItem, setCommentItem] = useState<ActiveOrder["items"][number] | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [showTakeawayConfirm, setShowTakeawayConfirm] = useState(false);
  const [showCompletionRecovery, setShowCompletionRecovery] = useState(false);
  const [cashShift, setCashShift] = useState<CashShift | null | undefined>(undefined);
  const [shiftName, setShiftName] = useState("");
  const [isOpeningShift, setIsOpeningShift] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [tableMap, setTableMap] = useState({
    cells: Array.from({ length: 12 }, (_, index) => index),
    rows: 6,
    columns: 8,
  });
  const activeOrderRevision = useRef(0);
  const activeOrderRef = useRef<CachedPosOrder | null>(null);
  const cachedOrdersRef = useRef<Record<string, CachedPosOrder>>({});
  const completingOrderIds = useRef(new Set<string>());
  const syncingKitchenPrintIds = useRef(new Set<string>());

  useEffect(() => {
    activeOrderRef.current = active;
  }, [active]);

  useEffect(() => {
    cachedOrdersRef.current = cachedOrders;
  }, [cachedOrders]);

  useEffect(() => {
    void readPosCache().then((cache) => {
      if (!cache) return;
      const restored = Object.fromEntries(cache.orders.map((order) => [order.id, order]));
      const restoredCompleted = cache.completedOrders ?? [];
      cachedOrdersRef.current = restored;
      setCachedOrders(restored);
      setCompletedOrders(restoredCompleted);
      setOrders(cache.summaries);
      const selected = cache.activeOrderId ? restored[cache.activeOrderId] ?? restoredCompleted.find((order) => order.id === cache.activeOrderId) : cache.orders[0] ?? restoredCompleted[0];
      if (selected) {
        activeOrderRef.current = selected;
        setActive(selected);
      }
    }).finally(() => setCacheReady(true));
  }, []);

  useEffect(() => {
    void (async () => {
      const autoCloseResponse = await fetch("/api/shifts/auto-close-stale", { method: "POST" });
      const autoClosePayload: unknown = await autoCloseResponse.json();
      if (!autoCloseResponse.ok || !isAutoCloseStaleShiftResponse(autoClosePayload))
        throw new Error(message(autoClosePayload, "Не удалось проверить незакрытую смену."));
      if (autoClosePayload.data.outcome === "closed" && autoClosePayload.data.shift) {
        const shift = autoClosePayload.data.shift;
        setNotice(`Смена за ${formatBusinessDate(shift.businessDate)}, открытая ${shift.openedBy}, автоматически закрыта в 00:00.`);
      }
      const response = await fetch("/api/shifts", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isShiftDashboardResponse(payload))
        throw new Error(message(payload, "Не удалось проверить смену."));
      setCashShift(payload.data.currentShift);
    })()
      .catch((cause) => {
        setShiftError(cause instanceof Error ? cause.message : "Не удалось проверить смену.");
        setCashShift(null);
      });
  }, []);

  useEffect(() => {
    // The initial render contains empty state. Do not let it overwrite the
    // IndexedDB snapshot while readPosCache is still restoring local carts and
    // completed tabs after navigation back to POS.
    if (!cacheReady) return;
    void writePosCache({ version: 1, activeOrderId: active?.id ?? null, orders: Object.values(cachedOrders), completedOrders, summaries: orders, savedAt: Date.now() });
  }, [active?.id, cacheReady, cachedOrders, completedOrders, orders]);

  const loadOrder = useCallback(
    async (id: string, revision = activeOrderRevision.current) => {
      const response = await fetch(`/api/active-orders/${id}`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload))
        throw new Error(message(payload, "Не удалось загрузить заказ."));
      if (revision !== activeOrderRevision.current) return;
      const existing = cachedOrdersRef.current[id];
      const order: CachedPosOrder = {
        ...payload.data,
        items: existing?.items.length && payload.data.items.length === 0 ? existing.items : payload.data.items,
        totalTyiyn: existing?.items.length && payload.data.items.length === 0 ? existing.totalTyiyn : payload.data.totalTyiyn,
        customerReceiptPrintedAt: existing?.customerReceiptPrintedAt,
        pendingCompletion: existing?.pendingCompletion,
        completionSyncError: existing?.completionSyncError,
        pendingKitchenPrints: existing?.pendingKitchenPrints,
        syncState: "synced",
      };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [order.id]: order };
      setCachedOrders(cachedOrdersRef.current);
      setActive(order);
      activeOrderRef.current = order;
    },
    [],
  );
  const loadOrders = useCallback(
    async (preferredId?: string | null) => {
      const revision = activeOrderRevision.current;
      const response = await fetch("/api/active-orders", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrdersResponse(payload))
        throw new Error(
          message(payload, "Не удалось загрузить активные заказы."),
        );
      if (revision !== activeOrderRevision.current) return;
      const incoming = payload.data.map((order) => {
        const cached = cachedOrdersRef.current[order.id];
        const hasLocalCart = Boolean(cached?.items.length && order.items.length === 0);
        return {
          ...order,
          items: hasLocalCart ? cached.items : order.items,
          totalTyiyn: hasLocalCart ? cached.totalTyiyn : order.totalTyiyn,
          hasKitchenTicket: cached?.hasKitchenTicket || order.hasKitchenTicket,
          customerReceiptPrintedAt: cached?.customerReceiptPrintedAt,
          pendingCompletion: cached?.pendingCompletion,
          completionSyncError: cached?.completionSyncError,
          pendingKitchenPrints: cached?.pendingKitchenPrints,
          syncState: "synced" as const,
        };
      });
      const localOnly = Object.values(cachedOrdersRef.current).filter((order) => order.syncState !== "synced");
      const nextOrders = [...incoming, ...localOnly];
      const nextCache = Object.fromEntries(nextOrders.map((order) => [order.id, order]));
      cachedOrdersRef.current = nextCache;
      setCachedOrders(nextCache);
      setOrders(nextOrders.map(toActiveOrderSummary));
      const completedActive = activeOrderRef.current?.completedAt ? activeOrderRef.current : null;
      const id = completedActive
        ? null
        : preferredId && nextCache[preferredId]
          ? preferredId
          : activeOrderRef.current?.id && nextCache[activeOrderRef.current.id]
            ? activeOrderRef.current.id
            : nextOrders[0]?.id;
      if (id) {
        const order = nextCache[id];
        if (order && revision === activeOrderRevision.current) {
          activeOrderRef.current = order;
          setActive(order);
        }
      }
      else if (completedActive) {
        activeOrderRef.current = completedActive;
        setActive(completedActive);
      } else setActive(null);
    },
    [],
  );
  const loadMenu = useCallback(async (showCached = false) => {
    if (showCached) {
      const cached = readCachedMenu();
      if (cached) setCatalog(cached);
    }
    const response = await fetch(
      `/api/menu?revision=${encodeURIComponent(readMenuRevision())}`,
    );
    const payload: unknown = await response.json();
    if (!response.ok || !isMenuResponse(payload))
      throw new Error(message(payload, "Не удалось загрузить меню."));
    writeCachedMenu(payload.data);
    setCatalog(payload.data);
  }, []);
  const loadTableMap = useCallback(async () => {
    const response = await fetch("/api/table-map", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok || !isTableMapResponse(payload))
      throw new Error(message(payload, "Не удалось загрузить карту столов."));
    setTableMap(payload.data);
  }, []);
  useEffect(() => {
    if (!cacheReady) return;
    const timer = window.setTimeout(
      () =>
        void Promise.all([loadMenu(true), loadOrders(), loadTableMap()]).catch(
          (cause: unknown) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить POS.",
            ),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [cacheReady, loadMenu, loadOrders, loadTableMap]);
  useEffect(() => {
    const timer = window.setInterval(
      () => void loadOrders(active?.id).catch(() => undefined),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [active?.id, loadOrders]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== menuRevisionKey) return;
      window.sessionStorage.removeItem(menuCacheKey);
      void loadMenu();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadMenu]);
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
    const selectedCategoryId = categoryId ?? catalog.categories[0]?.id;
    return catalog.categories.flatMap((category) =>
      category.items.filter(
        (item) =>
          item.categoryId === selectedCategoryId &&
          (!term || item.name.toLocaleLowerCase("ru-RU").includes(term)),
      ),
    );
  }, [catalog, categoryId, query]);
  const containerItem = useMemo(
    () => catalog?.categories.flatMap((category) => category.items).find((item) => item.isContainer && item.variants.length > 0) ?? null,
    [catalog],
  );
  const freeTables = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => index + 1).filter(
        (table) => !orders.some((order) => order.tableNumber === table),
      ),
    [orders],
  );
  const syncLocalOrder = useCallback(async (draft: CachedPosOrder) => {
    if (draft.syncState === "synced") return draft;
    const syncing = { ...draft, syncState: "syncing" as const, syncError: undefined };
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [draft.id]: syncing };
    setCachedOrders(cachedOrdersRef.current);
    try {
      const response = await fetch("/api/active-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: draft.syncKey, tableNumber: draft.tableNumber, serviceLocation: draft.serviceLocation ?? "hall" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось синхронизировать заказ."));
      const synced: CachedPosOrder = {
        ...payload.data,
        items: (cachedOrdersRef.current[draft.id] ?? draft).items,
        totalTyiyn: (cachedOrdersRef.current[draft.id] ?? draft).totalTyiyn,
        tableNumber: (cachedOrdersRef.current[draft.id] ?? draft).tableNumber,
        serviceLocation: (cachedOrdersRef.current[draft.id] ?? draft).serviceLocation ?? "hall",
        hasKitchenTicket: (cachedOrdersRef.current[draft.id] ?? draft).hasKitchenTicket,
        customerReceiptPrintedAt: (cachedOrdersRef.current[draft.id] ?? draft).customerReceiptPrintedAt,
        pendingCompletion: (cachedOrdersRef.current[draft.id] ?? draft).pendingCompletion,
        completionSyncError: (cachedOrdersRef.current[draft.id] ?? draft).completionSyncError,
        pendingKitchenPrints: (cachedOrdersRef.current[draft.id] ?? draft).pendingKitchenPrints,
        pendingCommentLineIds: (cachedOrdersRef.current[draft.id] ?? draft).pendingCommentLineIds,
        syncState: "synced",
        pendingTableNumber: payload.data.tableNumber === (cachedOrdersRef.current[draft.id] ?? draft).tableNumber
          ? undefined
          : (cachedOrdersRef.current[draft.id] ?? draft).tableNumber,
      };
      const nextCache = { ...cachedOrdersRef.current };
      delete nextCache[draft.id];
      nextCache[synced.id] = synced;
      cachedOrdersRef.current = nextCache;
      setCachedOrders(nextCache);
      setOrders((current) => [toActiveOrderSummary(synced), ...current.filter((order) => order.id !== draft.id && order.id !== synced.id)]);
      if (activeOrderRef.current?.id === draft.id) {
        activeOrderRef.current = synced;
        setActive(synced);
      }
      return synced;
    } catch (cause) {
      const failed = { ...draft, syncState: "sync-error" as const, syncError: cause instanceof Error ? cause.message : "Не удалось синхронизировать заказ." };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [draft.id]: failed };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === draft.id) {
        activeOrderRef.current = failed;
        setActive(failed);
      }
      throw cause;
    }
  }, []);
  const syncTableAssignment = useCallback(async (order: CachedPosOrder) => {
    if ((order.syncState !== "synced" && order.syncState !== "sync-error") || order.pendingTableNumber === undefined) return order;
    let rejectWithoutRetry = false;
    try {
      const response = await fetch(`/api/active-orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "move-table", tableNumber: order.pendingTableNumber }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) {
        rejectWithoutRetry = response.status >= 400 && response.status < 500;
        throw new Error(message(payload, "Не удалось назначить стол."));
      }
      const current = cachedOrdersRef.current[order.id] ?? order;
      const synced: CachedPosOrder = {
        ...payload.data,
        items: current.items,
        totalTyiyn: current.totalTyiyn,
        hasKitchenTicket: current.hasKitchenTicket,
        customerReceiptPrintedAt: current.customerReceiptPrintedAt,
        pendingCompletion: current.pendingCompletion,
        completionSyncError: current.completionSyncError,
        pendingKitchenPrints: current.pendingKitchenPrints,
        pendingCommentLineIds: current.pendingCommentLineIds,
        syncState: "synced",
        pendingTableNumber: current.pendingTableNumber === payload.data.tableNumber ? undefined : current.pendingTableNumber,
      };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [synced.id]: synced };
      setCachedOrders(cachedOrdersRef.current);
      setOrders((currentOrders) => currentOrders.map((summary) => summary.id === synced.id ? toActiveOrderSummary(synced) : summary));
      if (activeOrderRef.current?.id === synced.id) {
        activeOrderRef.current = synced;
        setActive(synced);
      }
      return synced;
    } catch (cause) {
      const syncError = cause instanceof Error ? cause.message : "Не удалось назначить стол.";
      if (rejectWithoutRetry) {
        // A validation/conflict error will not succeed on a background retry.
        // Reload the canonical server state and wait for the cashier to choose
        // another table instead of producing a PATCH request every 5 seconds.
        try {
          await loadOrders(activeOrderRef.current?.id ?? null);
        } catch {
          const rejected = {
            ...(cachedOrdersRef.current[order.id] ?? order),
            pendingTableNumber: undefined,
            syncState: "synced" as const,
          };
          cachedOrdersRef.current = { ...cachedOrdersRef.current, [rejected.id]: rejected };
          setCachedOrders(cachedOrdersRef.current);
          if (activeOrderRef.current?.id === rejected.id) {
            activeOrderRef.current = rejected;
            setActive(rejected);
          }
        }
        setError(syncError);
        return cachedOrdersRef.current[order.id] ?? order;
      }
      const failed = { ...(cachedOrdersRef.current[order.id] ?? order), syncState: "sync-error" as const, syncError: cause instanceof Error ? cause.message : "Не удалось назначить стол." };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [failed.id]: failed };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === failed.id) {
        activeOrderRef.current = failed;
        setActive(failed);
      }
      throw cause;
    }
  }, [loadOrders]);
  const syncDraftComment = useCallback(async (order: CachedPosOrder, clientLineId: string) => {
    if (order.syncState !== "synced" || !order.pendingCommentLineIds?.includes(clientLineId)) return;
    const line = order.items.find((item) => item.id === clientLineId);
    try {
      const response = await fetch(`/api/active-orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save-draft-comment", clientLineId, kitchenComment: line?.kitchenComment ?? null }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "Не удалось сохранить комментарий для кухни."));
      const current = cachedOrdersRef.current[order.id];
      if (!current) return;
      const next = { ...current, pendingCommentLineIds: current.pendingCommentLineIds?.filter((id) => id !== clientLineId) };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === next.id) { activeOrderRef.current = next; setActive(next); }
    } catch {
      // The local line stays authoritative and this retry runs in the background.
    }
  }, []);
  const completePrintedOrder = useCallback(async (draft: CachedPosOrder) => {
    if (!draft.pendingCompletion || !draft.customerReceiptPrintedAt) return false;
    if (completingOrderIds.current.has(draft.id)) return false;
    completingOrderIds.current.add(draft.id);
    let order = draft;
    try {
      if (order.syncState !== "synced") order = await syncLocalOrder(order);
      const response = await fetch(`/api/active-orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete-local-cart",
          customerReceiptPrinted: true,
          items: order.items.map((item) => ({
            menuItemId: item.menuItemId,
            menuItemVariantId: item.menuItemVariantId,
            quantity: item.quantity,
            ...(item.menuItemId !== null ? { serviceLocation: item.serviceLocation ?? "hall" } : {}),
            ...(item.kitchenComment ? { kitchenComment: item.kitchenComment } : {}),
            ...(item.menuItemId === null ? { adHocAmountTyiyn: item.unitPriceTyiyn } : {}),
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload))
        throw new Error(message(payload, "Не удалось синхронизировать завершённый заказ."));
      const completed: CompletedPosOrder = {
        ...(cachedOrdersRef.current[order.id] ?? order),
        syncState: "synced",
        pendingCompletion: false,
        completionSyncError: undefined,
        pendingKitchenPrints: undefined,
        completedAt: new Date().toISOString(),
      };
      const remaining = { ...cachedOrdersRef.current };
      delete remaining[draft.id];
      delete remaining[order.id];
      cachedOrdersRef.current = remaining;
      setCachedOrders(remaining);
      setCompletedOrders((current) => [completed, ...current.filter((entry) => entry.id !== completed.id && entry.id !== draft.id)]);
      setOrders((current) => current.filter((summary) => summary.id !== draft.id && summary.id !== order.id));
      if (activeOrderRef.current?.id === draft.id || activeOrderRef.current?.id === order.id) {
        activeOrderRef.current = completed;
        setActive(completed);
      }
      await loadOrders(null);
      setNotice("Заказ синхронизирован с сервером.");
      setError(null);
      return true;
    } catch (cause) {
      const current = cachedOrdersRef.current[order.id] ?? cachedOrdersRef.current[draft.id] ?? order;
      const failed: CachedPosOrder = {
        ...current,
        pendingCompletion: true,
        customerReceiptPrintedAt: draft.customerReceiptPrintedAt,
        completionSyncError: cause instanceof Error ? cause.message : "Не удалось синхронизировать завершённый заказ.",
      };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [failed.id]: failed };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === draft.id || activeOrderRef.current?.id === failed.id) {
        activeOrderRef.current = failed;
        setActive(failed);
      }
      throw cause;
    } finally {
      completingOrderIds.current.delete(draft.id);
    }
  }, [loadOrders, syncLocalOrder]);
  const syncPendingKitchenPrint = useCallback(async (draft: CachedPosOrder, pending: PendingKitchenPrint) => {
    if (syncingKitchenPrintIds.current.has(pending.idempotencyKey)) return draft;
    syncingKitchenPrintIds.current.add(pending.idempotencyKey);
    try {
      let order = draft;
      if (order.syncState !== "synced") order = await syncLocalOrder(order);
      const response = await fetch(`/api/active-orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: pending.kind === "cancellation"
            ? "print-local-cart-cancellation-to-kitchen"
            : "print-local-cart-to-kitchen",
          idempotencyKey: pending.idempotencyKey,
          stationId: getPrintStationId(),
          printedLocally: true,
          items: pending.items,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload))
        throw new Error(message(payload, "Не удалось синхронизировать кухонный чек."));

      const current = cachedOrdersRef.current[order.id] ?? order;
      const next = {
        ...current,
        hasKitchenTicket: true,
        pendingKitchenPrints: (current.pendingKitchenPrints ?? []).filter((entry) => entry.idempotencyKey !== pending.idempotencyKey),
      };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === next.id) {
        activeOrderRef.current = next;
        setActive(next);
      }
      return next;
    } finally {
      syncingKitchenPrintIds.current.delete(pending.idempotencyKey);
    }
  }, [syncLocalOrder]);
  useEffect(() => {
    const synchronizePendingOrders = () => {
      for (const order of Object.values(cachedOrdersRef.current)) {
        if (order.pendingCompletion && order.customerReceiptPrintedAt) {
          void completePrintedOrder(order).catch(() => undefined);
          continue;
        }
        if (order.pendingKitchenPrints?.length) {
          for (const pending of order.pendingKitchenPrints)
            void syncPendingKitchenPrint(order, pending).catch(() => undefined);
          continue;
        }
        if (order.syncState === "synced" && order.pendingCommentLineIds?.length) {
          for (const lineId of order.pendingCommentLineIds) void syncDraftComment(order, lineId);
        }
        if (order.pendingTableNumber !== undefined && !order.syncKey) {
          void syncTableAssignment(order).catch(() => undefined);
          continue;
        }
        if (order.syncState === "local" || order.syncState === "sync-error") {
          void syncLocalOrder(order).catch(() => undefined);
          continue;
        }
        if (order.syncState === "synced" && order.pendingTableNumber !== undefined)
          void syncTableAssignment(order).catch(() => undefined);
      }
    };
    synchronizePendingOrders();
    const timer = window.setInterval(synchronizePendingOrders, 5_000);
    window.addEventListener("online", synchronizePendingOrders);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", synchronizePendingOrders);
    };
  }, [completePrintedOrder, syncDraftComment, syncLocalOrder, syncPendingKitchenPrint, syncTableAssignment]);
  const createLocalOrder = useCallback(() => {
    activeOrderRevision.current += 1;
    const localOrderId = `local-order-${crypto.randomUUID()}`;
    const localOrder: CachedPosOrder = {
      id: localOrderId,
      orderNumber: 0,
      tableNumber: null,
      serviceLocation: "hall",
      totalTyiyn: 0,
      cashierName: "",
      createdAt: new Date().toISOString(),
      items: [],
      hasKitchenTicket: false,
      syncState: "local",
      syncKey: crypto.randomUUID(),
    };
    activeOrderRef.current = localOrder;
    setActive(localOrder);
    setOrders((current) => [toActiveOrderSummary(localOrder), ...current]);
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [localOrder.id]: localOrder };
    setCachedOrders(cachedOrdersRef.current);
    setNotice(null);
    setShowTables(false);
    setNotice("Новый заказ создан локально.");
    setError(null);
    window.setTimeout(() => void syncLocalOrder(localOrder).catch(() => undefined), 750);
    return localOrder;
  }, [syncLocalOrder]);
  const createOrder = useCallback(() => {
    if (isCreating) return;
    const reusable = findReusableEmptyOrder(Object.values(cachedOrdersRef.current));
    if (reusable) {
      activeOrderRevision.current += 1;
      activeOrderRef.current = reusable;
      setActive(reusable);
      setShowTables(false);
      setNotice("Открыт существующий пустой заказ.");
      setError(null);
      return;
    }
    setIsCreating(true);
    createLocalOrder();
    setIsCreating(false);
  }, [createLocalOrder, isCreating]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.code !== "KeyQ" && event.code !== "KeyN") || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.code === "KeyQ") {
        if (!activeOrderRef.current || isTransitioning) return;
        event.preventDefault();
        setShowUnknownPurchase(true);
        return;
      }
      if (isTransitioning) return;
      event.preventDefault();
      void createOrder();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createOrder, isTransitioning]);
  async function selectOrder(id: string) {
    if (isTransitioning) return;
    const cached = cachedOrdersRef.current[id];
    if (cached) {
      activeOrderRevision.current += 1;
      activeOrderRef.current = cached;
      setActive(cached);
      return;
    }
    const revision = ++activeOrderRevision.current;
    setIsTransitioning(true);
    try {
      await loadOrder(id, revision);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось открыть заказ.",
      );
    } finally {
      setIsTransitioning(false);
    }
  }
  function selectCompletedOrder(order: CompletedPosOrder) {
    if (isTransitioning) return;
    activeOrderRevision.current += 1;
    activeOrderRef.current = order;
    setActive(order);
  }
  function dismissCompletedOrder(id: string) {
    setCompletedOrders((current) => current.filter((order) => order.id !== id));
    if (activeOrderRef.current?.id === id) {
      activeOrderRef.current = null;
      setActive(null);
    }
  }
  async function assignTable(tableNumber: number) {
    if (!active || active.serviceLocation === "takeaway" || active.pendingCompletion || isTransitioning) return;
    const local: CachedPosOrder = {
      ...active,
      tableNumber,
      pendingTableNumber: tableNumber,
      syncState: active.syncState === "synced" ? "synced" : active.syncState,
      syncError: undefined,
    };
    activeOrderRef.current = local;
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [local.id]: local };
    setCachedOrders(cachedOrdersRef.current);
    setActive(local);
    setOrders((current) => current.map((order) => order.id === local.id ? toActiveOrderSummary(local) : order));
    setShowTables(false);
    setNotice(`Стол ${tableNumber} назначен локально.`);
    if (local.syncState === "synced")
      void syncTableAssignment(local).catch(() => undefined);
  }
  function changeServiceLocation(serviceLocation: "hall" | "takeaway", confirmed = false) {
    const current = activeOrderRef.current;
    if (!current || current.pendingCompletion || current.serviceLocation === serviceLocation) return;
    if (serviceLocation === "takeaway" && current.tableNumber && !confirmed) {
      setShowTakeawayConfirm(true);
      return;
    }
    const next: CachedPosOrder = {
      ...current,
      serviceLocation,
      tableNumber: serviceLocation === "takeaway" ? null : current.tableNumber,
      pendingTableNumber: serviceLocation === "takeaway" ? undefined : current.pendingTableNumber,
      pendingServiceLocation: serviceLocation,
    };
    activeOrderRef.current = next;
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
    setCachedOrders(cachedOrdersRef.current);
    setActive(next);
    setOrders((orders) => orders.map((order) => order.id === next.id ? toActiveOrderSummary(next) : order));
    setShowTables(false);
    if (next.syncState !== "synced") return;
    void fetch(`/api/active-orders/${next.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-service-location", serviceLocation }),
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось изменить режим заказа."));
      const saved = cachedOrdersRef.current[next.id];
      if (!saved) return;
      const synced = { ...saved, ...payload.data, items: saved.items, totalTyiyn: saved.totalTyiyn, pendingServiceLocation: undefined, pendingTableNumber: payload.data.tableNumber === saved.tableNumber ? undefined : saved.pendingTableNumber };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [synced.id]: synced };
      setCachedOrders(cachedOrdersRef.current);
      if (activeOrderRef.current?.id === synced.id) { activeOrderRef.current = synced; setActive(synced); }
    }).catch((cause) => {
      const saved = cachedOrdersRef.current[next.id];
      if (saved?.pendingServiceLocation === serviceLocation) {
        const reverted = { ...saved, serviceLocation: current.serviceLocation, tableNumber: current.tableNumber, pendingTableNumber: current.pendingTableNumber, pendingServiceLocation: undefined };
        cachedOrdersRef.current = { ...cachedOrdersRef.current, [reverted.id]: reverted };
        setCachedOrders(cachedOrdersRef.current);
        if (activeOrderRef.current?.id === reverted.id) { activeOrderRef.current = reverted; setActive(reverted); }
      }
      setError(cause instanceof Error ? cause.message : "Не удалось изменить режим заказа.");
    });
  }
  function addItem(item: MenuItem, variant: MenuItem["variants"][number] | undefined) {
    const order = activeOrderRef.current;
    if (!order || order.pendingCompletion || order.completedAt) return;
    queueItemChange(order.id, selectMenuItem(item, variant, order.serviceLocation ?? "hall"), 1);
  }
  function ensureOrderForCatalog() {
    const current = activeOrderRef.current;
    if (current && !current.pendingCompletion && !current.completedAt) return current;
    if (orders.length > 0 || Object.keys(cachedOrdersRef.current).length > 0) {
      setNotice("Выберите открытый заказ.");
      return null;
    }
    return createLocalOrder();
  }
  function offerContainer() {
    if (containerItem) setContainerPrompt(containerItem);
  }
  function addUnknownPurchase() {
    if (!active || active.pendingCompletion || isTransitioning) return;
    const amountTyiyn = parseSomAmount(unknownPurchaseAmount);
    if (!amountTyiyn) {
      setError("Введите сумму неизвестной покупки.");
      return;
    }
    const unknownItem: ActiveOrder["items"][number] = {
      id: `unknown-${crypto.randomUUID()}`,
      menuItemId: null,
      menuItemVariantId: null,
      itemName: "Неизвестная покупка",
      unitPriceTyiyn: amountTyiyn,
      quantity: 1,
      sentQuantity: 1,
      lineTotalTyiyn: amountTyiyn,
      addedAt: new Date().toISOString(),
      preparesInKitchen: false,
    };
    setActive((current) => {
      if (!current) return current;
      const items = [unknownItem, ...current.items];
      const next = { ...current, items, totalTyiyn: calculateCartTotal(items) };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      return next;
    });
    setOrders((current) => current.map((order) => order.id === active.id
      ? { ...order, totalTyiyn: calculateCartTotal(activeOrderRef.current?.id === active.id ? activeOrderRef.current.items : []) }
      : order));
    setUnknownPurchaseAmount("");
    setShowUnknownPurchase(false);
    setNotice("Неизвестная покупка добавлена в заказ.");
  }
  function subtractItem(item: ActiveOrder["items"][number]) {
    if (!active || active.pendingCompletion) return;
    if (item.menuItemId !== null && item.preparesInKitchen && item.sentQuantity > 0) {
      setKitchenCancellationItem(item);
      return;
    }
    if (item.menuItemId === null) {
      changeUnknownPurchaseQuantity(item, -1);
      return;
    }
    queueItemChange(active.id, selectOrderItem(item), -1);
  }
  function changeUnknownPurchaseQuantity(item: ActiveOrder["items"][number], delta: number) {
    if (!active || item.menuItemId !== null || active.pendingCompletion) return;
    const nextQuantity = item.quantity + delta;
    const orderId = active.id;
    setActive((current) => {
      if (!current || current.id !== orderId) return current;
      const items = nextQuantity <= 0
        ? current.items.filter((candidate) => candidate.id !== item.id)
        : current.items.map((candidate) => candidate.id === item.id
          ? { ...candidate, quantity: nextQuantity, lineTotalTyiyn: candidate.unitPriceTyiyn * nextQuantity }
          : candidate);
      const next = { ...current, items, totalTyiyn: calculateCartTotal(items) };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      return next;
    });
    setOrders((current) => current.map((order) => order.id === orderId
      ? { ...order, totalTyiyn: calculateCartTotal(activeOrderRef.current?.id === orderId ? activeOrderRef.current.items : []) }
      : order));
  }
  async function removeItem(item: ActiveOrder["items"][number]) {
    if (!active || active.pendingCompletion || isTransitioning) return;
    if (item.menuItemId !== null && item.preparesInKitchen && item.sentQuantity > 0) {
      setKitchenCancellationItem(item);
      return;
    }
    if (item.menuItemId === null) {
      const orderId = active.id;
      const removeUnknownItem = (order: CachedPosOrder) => ({
        ...order,
        items: order.items.filter((candidate) => candidate.id !== item.id),
        totalTyiyn: calculateCartTotal(order.items.filter((candidate) => candidate.id !== item.id)),
      });
      const next = removeUnknownItem(cachedOrdersRef.current[orderId] ?? active);
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [orderId]: next };
      setCachedOrders(cachedOrdersRef.current);
      activeOrderRef.current = next;
      setActive(next);
      setOrders((current) => current.map((order) => order.id === orderId ? toActiveOrderSummary(next) : order));
      setNotice("Неизвестная покупка удалена из заказа.");
      return;
    }
    queueItemChange(active.id, selectOrderItem(item), -item.quantity);
  }
  function saveKitchenComment() {
    const item = commentItem;
    const order = activeOrderRef.current;
    const kitchenComment = commentDraft.trim().slice(0, 280) || null;
    if (!item || !order || item.sentQuantity > 0 || order.pendingCompletion) return;
    const next = {
      ...order,
      items: order.items.map((candidate) => candidate.id === item.id ? { ...candidate, kitchenComment } : candidate),
      pendingCommentLineIds: [...new Set([...(order.pendingCommentLineIds ?? []), item.id])],
    };
    activeOrderRef.current = next;
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
    setCachedOrders(cachedOrdersRef.current);
    setActive(next);
    setCommentItem(null);
    setCommentDraft("");
    void syncDraftComment(next, item.id);
  }
  async function confirmKitchenCancellation() {
    const item = kitchenCancellationItem;
    if (!active || !item || item.menuItemId === null || active.pendingCompletion || isTransitioning) return;
    setIsTransitioning(true);
    setNotice(null);
    try {
      const pending: PendingKitchenPrint = {
        idempotencyKey: crypto.randomUUID(),
        printedAt: new Date().toISOString(),
        kind: "cancellation",
        items: [{
          menuItemId: item.menuItemId,
          menuItemVariantId: item.menuItemVariantId,
          quantity: item.quantity,
          serviceLocation: item.serviceLocation ?? "hall",
          kitchenComment: item.kitchenComment ?? null,
        }],
      };
      await printKitchenReceiptSnapshot(
        toLocalKitchenReceipt(active, [item], pending.items),
        { cancellation: true },
      );
      const next = {
        ...active,
        items: active.items.filter((candidate) => candidate.id !== item.id),
        totalTyiyn: calculateCartTotal(active.items.filter((candidate) => candidate.id !== item.id)),
        pendingKitchenPrints: [...(active.pendingKitchenPrints ?? []), pending],
      };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      setActive(next);
      setOrders((current) => current.map((order) => order.id === next.id ? toActiveOrderSummary(next) : order));
      setKitchenCancellationItem(null);
      setNotice(`${item.itemName}: отмена напечатана для кухни.`);
      void syncPendingKitchenPrint(next, pending).catch((cause) => {
        setError(cause instanceof Error
          ? `Чек отмены напечатан. ${cause.message}`
          : "Чек отмены напечатан и будет синхронизирован автоматически.");
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось распечатать чек отмены для кухни.");
    } finally {
      setIsTransitioning(false);
    }
  }
  function queueItemChange(
    orderId: string,
    item: SelectedMenuItem,
    delta: number,
  ) {
    if (cachedOrdersRef.current[orderId]?.pendingCompletion) return;
    applyOptimisticItemChange(orderId, item, delta);
  }
  async function printLocalItemsToKitchen(
    items: ActiveOrder["items"],
    successMessage: string,
    repeat = false,
  ) {
    const kitchenItems = items.filter(
      (item) =>
        item.menuItemId !== null &&
        item.preparesInKitchen &&
        (repeat || item.sentQuantity < item.quantity),
    );
    if (
      !active ||
      kitchenItems.length === 0 ||
      active.pendingCompletion ||
      isTransitioning
    )
      return;
    setIsTransitioning(true);
    setNotice(null);
    try {
      const pending: PendingKitchenPrint = {
        idempotencyKey: crypto.randomUUID(),
        printedAt: new Date().toISOString(),
        kind: "new",
        items: kitchenItems.flatMap((item) => item.menuItemId ? [{
          menuItemId: item.menuItemId,
          menuItemVariantId: item.menuItemVariantId,
          quantity: repeat ? item.quantity : item.quantity - item.sentQuantity,
          serviceLocation: item.serviceLocation ?? "hall",
          kitchenComment: item.kitchenComment ?? null,
        }] : []),
      };
      if (!pending.items.length) return;
      await printKitchenReceiptSnapshot(toLocalKitchenReceipt(active, kitchenItems, pending.items));
      const sentItemIds = new Set(kitchenItems.map((item) => item.id));
      const next = {
        ...active,
        hasKitchenTicket: true,
        pendingKitchenPrints: [...(active.pendingKitchenPrints ?? []), pending],
        items: active.items.map((item) =>
          !repeat && sentItemIds.has(item.id) ? { ...item, sentQuantity: item.quantity } : item,
        ),
      };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      setActive(next);
      setNotice(successMessage);
      void syncPendingKitchenPrint(next, pending).catch((cause) => {
        setError(cause instanceof Error ? `Кухонный чек напечатан. ${cause.message}` : "Кухонный чек напечатан и будет синхронизирован автоматически.");
      });
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось распечатать кухонный чек.",
      );
    } finally {
      setIsTransitioning(false);
    }
  }
  function applyOptimisticItemChange(
    orderId: string,
    item: SelectedMenuItem,
    delta: number,
  ) {
    const current = activeOrderRef.current;
    if (!current || current.id !== orderId) return;
    const pendingIndex = item.targetLineId
      ? current.items.findIndex((line) => line.id === item.targetLineId && line.sentQuantity === 0)
      : current.items.findIndex(
          (line) =>
            line.menuItemId === item.id &&
            line.menuItemVariantId === item.selectedVariantId &&
            line.serviceLocation === item.serviceLocation &&
            (line.kitchenComment ?? null) === (item.kitchenComment ?? null) &&
            line.sentQuantity === 0,
        );
    let items = current.items;
    if (pendingIndex === -1 && delta > 0)
      items = [
        {
          id: `optimistic-${crypto.randomUUID()}`,
          menuItemId: item.id,
          menuItemVariantId: item.selectedVariantId,
          serviceLocation: item.serviceLocation,
          itemName: item.displayName,
          unitPriceTyiyn: item.priceTyiyn,
          quantity: delta,
          sentQuantity: 0,
          lineTotalTyiyn: item.priceTyiyn * delta,
          addedAt: new Date().toISOString(),
          preparesInKitchen: item.preparesInKitchen,
          kitchenComment: item.kitchenComment ?? null,
        },
        ...items,
      ];
    else if (pendingIndex >= 0) {
      const line = items[pendingIndex];
      const quantity = line.quantity + delta;
      if (quantity <= 0)
        items = items.filter((_, index) => index !== pendingIndex);
      else
        items = items.map((entry, index) =>
          index === pendingIndex
            ? {
                ...entry,
                quantity,
                lineTotalTyiyn: entry.unitPriceTyiyn * quantity,
              }
            : entry,
        );
    }
    const next = {
      ...current,
      items,
      totalTyiyn: calculateCartTotal(items),
    };
    activeOrderRef.current = next;
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
    setCachedOrders(cachedOrdersRef.current);
    setActive(next);
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? toActiveOrderSummary(next)
          : order,
      ),
    );
  }
  async function completeOrder() {
    if (
      !active ||
      active.pendingCompletion ||
      isTransitioning
    )
      return;
    const totalTyiyn = calculateCartTotal(active.items);
    if (active.items.length === 0 || totalTyiyn <= 0) {
      setError("Нельзя завершить пустой заказ или заказ с нулевой суммой.");
      return;
    }
    activeOrderRevision.current += 1;
    let order = { ...active, totalTyiyn };
    if (order.totalTyiyn !== active.totalTyiyn) {
      activeOrderRef.current = order;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [order.id]: order };
      setCachedOrders(cachedOrdersRef.current);
      setActive(order);
      setOrders((current) => current.map((summary) => summary.id === order.id ? toActiveOrderSummary(order) : summary));
    }
    setIsTransitioning(true);
    setNotice(null);
    try {
      if (!order.customerReceiptPrintedAt) {
        await printCustomerReceiptSnapshot(toLocalCustomerReceipt(order));
        order = {
          ...order,
          customerReceiptPrintedAt: new Date().toISOString(),
        };
      }
      order = { ...order, pendingCompletion: true, completionSyncError: undefined };
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [order.id]: order };
      setCachedOrders(cachedOrdersRef.current);
      activeOrderRef.current = order;
      setActive(order);
      const completed = await completePrintedOrder(order);
      if (!completed) return;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Чек уже напечатан. ${cause.message}`
          : "Чек уже напечатан. Заказ сохранён на устройстве и будет синхронизирован автоматически.",
      );
    } finally {
      setIsTransitioning(false);
    }
  }
  async function retryCompletionSync() {
    const order = activeOrderRef.current;
    if (!order?.pendingCompletion || isTransitioning) return;
    setIsTransitioning(true);
    setError(null);
    try {
      await completePrintedOrder(order);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Не удалось синхронизировать заказ: ${cause.message}`
          : "Не удалось синхронизировать заказ. Проверьте подключение и повторите попытку.",
      );
    } finally {
      setIsTransitioning(false);
    }
  }
  function returnPendingCompletionToCart() {
    const order = activeOrderRef.current;
    if (!order?.pendingCompletion) return;
    const recovered: CachedPosOrder = {
      ...order,
      pendingCompletion: false,
      completionSyncError: undefined,
    };
    activeOrderRef.current = recovered;
    cachedOrdersRef.current = { ...cachedOrdersRef.current, [recovered.id]: recovered };
    setCachedOrders(cachedOrdersRef.current);
    setActive(recovered);
    setShowCompletionRecovery(false);
    setError(null);
    setNotice("Заказ снова доступен для исправления. Клиентский чек уже напечатан и повторно не будет печататься.");
  }
  async function deleteEmptyOrder() {
    if (
      !active ||
      active.items.length > 0 ||
      active.pendingCompletion ||
      isTransitioning
    )
      return;
    if (active.customerReceiptPrintedAt) {
      setError("Нельзя удалить заказ, для которого уже напечатан клиентский чек. Исправьте позиции и повторите синхронизацию.");
      return;
    }
    const orderId = active.id;
    if (active.syncState !== "synced") {
      const remaining = { ...cachedOrdersRef.current };
      delete remaining[orderId];
      cachedOrdersRef.current = remaining;
      setCachedOrders(remaining);
      setOrders((current) => current.filter((order) => order.id !== orderId));
      setActive(null);
      setNotice("Локальный заказ удалён.");
      return;
    }
    activeOrderRevision.current += 1;
    setIsTransitioning(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/active-orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete-empty" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok)
        throw new Error(message(payload, "Не удалось удалить пустой заказ."));
      await loadOrders(null);
      setNotice("Пустой заказ удалён.");
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось удалить пустой заказ.",
      );
    } finally {
      setIsTransitioning(false);
    }
  }

  const itemCount =
    active?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const activeTotalTyiyn = active ? calculateCartTotal(active.items) : 0;
  const hasPendingKitchenItems =
    active?.items.some(
      (item) => item.menuItemId !== null && item.preparesInKitchen && item.sentQuantity < item.quantity,
    ) ?? false;
  const isOrderLocked = isTransitioning || Boolean(active?.pendingCompletion || active?.completedAt);
  const orderedOrders = useMemo(
    () => [...orders].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [orders],
  );
  const orderedCompletedOrders = useMemo(
    () => [...completedOrders].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [completedOrders],
  );

  async function openShift() {
    if (!shiftName.trim() || isOpeningShift) {
      if (!shiftName.trim()) setShiftError("Введите имя кассира.");
      return;
    }
    setIsOpeningShift(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openedBy: shiftName }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isCashShiftResponse(payload))
        throw new Error(message(payload, "Не удалось открыть смену."));
      setCashShift(payload.data);
      setShiftError(null);
    } catch (cause) {
      setShiftError(cause instanceof Error ? cause.message : "Не удалось открыть смену.");
    } finally {
      setIsOpeningShift(false);
    }
  }

  if (cashShift === undefined) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">Проверяем смену…</p>;
  }
  if (!cashShift) {
    return (
      <section className="mx-auto mt-10 max-w-md rounded-[1.7rem] border border-white/80 bg-white/90 p-6 shadow-[0_10px_34px_rgba(56,72,65,0.1)] backdrop-blur-xl">
        <p className="text-sm font-semibold text-primary-strong">Начало рабочего дня</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Откройте смену</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Перед началом продаж укажите имя кассира. Заказы дня будут учтены в этой смене.</p>
        <label className="mt-6 block text-sm font-semibold text-slate-700">
          Имя кассира
          <input autoFocus value={shiftName} onChange={(event) => setShiftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void openShift(); }} maxLength={100} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-primary" placeholder="Например, Айжан" />
        </label>
        {shiftError && <p role="alert" className="mt-3 text-sm text-red-700">{shiftError}</p>}
        <button type="button" onClick={() => void openShift()} disabled={isOpeningShift} className="mt-6 w-full rounded-xl bg-primary px-4 py-3 font-bold text-white disabled:opacity-50">
          {isOpeningShift ? "Открываем…" : "Открыть смену"}
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-2 overflow-hidden rounded-2xl border border-white/80 bg-white/90 p-2 shadow-[0_8px_24px_rgba(56,72,65,0.07)] backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 overflow-x-auto py-0.5 pr-0.5">
          {orderedCompletedOrders.length > 0 && (
            <div className="flex shrink-0 gap-2 border-r border-slate-200 pr-2" aria-label="Завершённые заказы">
              {orderedCompletedOrders.map((order) => (
                <div key={order.id} className={`flex min-w-20 items-center rounded-xl border text-sm font-bold transition ${active?.id === order.id ? "border-emerald-600 bg-emerald-200 text-emerald-950" : "border-emerald-300 bg-emerald-100 text-emerald-950"}`}>
                  <button type="button" onClick={() => selectCompletedOrder(order)} className="min-w-0 flex-1 px-3 py-2 text-center" aria-label={`Открыть завершённый заказ ${orderTitle(order)}`}>{orderTitle(order)}</button>
                  <button type="button" onClick={() => dismissCompletedOrder(order.id)} className="mr-1 grid size-6 place-items-center rounded-md text-lg leading-none hover:bg-emerald-300" aria-label={`Убрать завершённый заказ ${orderTitle(order)} из вкладок`} title="Убрать вкладку">×</button>
                </div>
              ))}
            </div>
          )}
          <div className={`flex shrink-0 gap-2 ${orderedCompletedOrders.length > 0 ? "pl-2" : ""}`} aria-label="Незавершённые заказы">
            {orderedOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => void selectOrder(order.id)}
                disabled={isTransitioning}
                className={`min-w-20 rounded-xl border px-3 py-2 text-center text-sm font-bold transition ${active?.id === order.id ? "border-amber-500 bg-amber-200 text-amber-950" : "border-amber-300 bg-amber-100 text-amber-950 hover:border-amber-500"}`}
              >
                {orderTitle(order)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void createOrder()}
          disabled={isCreating}
          className="shrink-0 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-white shadow-[0_6px_14px_rgba(17,170,160,0.18)] disabled:opacity-50"
        >
          {isCreating ? "Создаём…" : "+ Новый заказ"}
        </button>
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 grid justify-items-center gap-2 px-4">
        {error && (
          <Toast kind="error" onClose={() => setError(null)}>
            {error}
          </Toast>
        )}
        {notice && (
          <Toast kind="success" onClose={() => setNotice(null)}>
            {notice}
          </Toast>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.03fr)_minmax(28rem,.97fr)]">
        <section className="min-w-0 rounded-[1.7rem] border border-white/80 bg-white/90 p-4 shadow-[0_10px_34px_rgba(56,72,65,0.08)] backdrop-blur-xl sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-[-0.04em] text-slate-950">
              Каталог блюд
            </h2>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary sm:w-56"
            />
          </div>
          {catalog && (
            <div className="mb-4 flex flex-wrap gap-2">
              {catalog.categories.map((category) => (
                <CategoryButton
                  key={category.id}
                  active={
                    (categoryId ?? catalog.categories[0]?.id) === category.id
                  }
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </CategoryButton>
              ))}
            </div>
          )}
          {!catalog ? (
            <p className="rounded-xl bg-surface-muted p-5 text-slate-600">
              Загрузка меню…
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {menuItems.map((item) => {
                  const hasMultipleVariants = item.variants.length > 1;
                  const singleVariant =
                    item.variants.length === 1 ? item.variants[0] : undefined;
                  const canChooseItem = Boolean(active && !active.pendingCompletion && !active.completedAt) || (!active && orders.length === 0);
                  const chooseCard = () => {
                    if (!ensureOrderForCatalog()) return;
                    if (hasMultipleVariants) {
                      setVariantPicker({ item });
                      return;
                    }
                    addItem(item, singleVariant);
                    if ((activeOrderRef.current?.serviceLocation ?? "hall") === "takeaway" && !item.isContainer) offerContainer();
                  };
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={canChooseItem ? 0 : -1}
                      onClick={chooseCard}
                      onKeyDown={(event) => {
                        if (
                          (event.key === "Enter" || event.key === " ") &&
                          canChooseItem
                        ) {
                          event.preventDefault();
                          chooseCard();
                        }
                      }}
                      className={`min-h-22 cursor-pointer rounded-xl border border-slate-200 p-3 text-left transition hover:-translate-y-px hover:border-primary ${active?.serviceLocation === "takeaway" ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-teal-50"} ${!canChooseItem ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      <div className="block w-full text-left">
                        <span className="block font-semibold text-slate-900">
                          {item.name}
                        </span>
                        {hasMultipleVariants ? (
                          <span className="mt-1.5 flex flex-col gap-0.5 text-[11px] font-medium text-primary-strong">
                            {item.variants.map((variant) => (
                              <span
                                key={variant.id}
                                className="flex min-w-0 items-center justify-between gap-2"
                              >
                                <span className="truncate">{variant.name}</span>
                                <span className="shrink-0">
                                  {formatSom(variant.priceTyiyn)}
                                </span>
                              </span>
                            ))}
                            <span className="mt-0.5 text-xs">⌄</span>
                          </span>
                        ) : (
                          <span className="mt-2 block text-base font-bold text-primary-strong">
                            {formatSom(
                              singleVariant?.priceTyiyn ?? item.priceTyiyn,
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          {!active && (
            <p className="mt-5 text-sm text-slate-500">
              Нажмите «Новый заказ», затем сразу добавляйте блюда.
            </p>
          )}
        </section>
        <aside className="min-w-0 xl:sticky xl:top-3 xl:self-start">
          <div className="flex max-h-[calc(100dvh-8.5rem)] flex-col rounded-[1.7rem] border border-white/80 bg-white/90 p-4 shadow-[0_10px_34px_rgba(56,72,65,0.08)] backdrop-blur-xl sm:p-5">
            <div className="relative shrink-0 border-b border-slate-100 pb-3">
              <div className="flex items-start justify-between gap-3 pr-12">
                <div>
                  {active?.serviceLocation !== "takeaway" && (
                    <button
                      type="button"
                      onClick={() => setShowTables((value) => !value)}
                      disabled={!active || isOrderLocked}
                      className="flex items-center gap-2 text-left text-xl font-bold tracking-[-0.04em] text-slate-950 disabled:opacity-50"
                    >
                      {active ? activeTitle(active) : "Активный заказ"}
                      <span className="text-base text-primary">⌄</span>
                    </button>
                  )}
                  {active?.serviceLocation === "takeaway" && <p className="text-xl font-bold tracking-[-0.04em] text-slate-950">Заказ на вынос</p>}
                  {!active && <p className="text-xl font-bold tracking-[-0.04em] text-slate-950">Активный заказ</p>}
                  {active && (
                    <div className="mt-2 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Режим обслуживания заказа">
                      <button type="button" onClick={() => changeServiceLocation("hall")} disabled={isOrderLocked} className={`rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-40 ${active.serviceLocation !== "takeaway" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>Зал</button>
                      <button type="button" onClick={() => changeServiceLocation("takeaway")} disabled={isOrderLocked} className={`rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-40 ${active.serviceLocation === "takeaway" ? "bg-amber-400 text-amber-950 shadow-sm" : "text-slate-500 hover:bg-amber-50 hover:text-amber-950"}`}><span aria-hidden="true">⇥ </span>Вынос</button>
                    </div>
                  )}
                </div>
              </div>
              {active && (
                <p className="mt-1 text-sm text-slate-500">
                  {active.pendingCompletion
                    ? `Чек напечатан · ожидает синхронизации${active.completionSyncError ? `: ${active.completionSyncError}` : ""}`
                    : active.customerReceiptPrintedAt
                      ? "Клиентский чек уже напечатан · заказ можно исправить и сохранить повторно"
                    : active.syncState === "local"
                    ? "Сохранён на устройстве"
                    : active.syncState === "syncing"
                      ? "Синхронизация…"
                      : active.syncState === "sync-error"
                        ? `Не синхронизировано: ${active.syncError ?? "повторим автоматически"}`
                        : `Заказ №${active.orderNumber} · открыт`}
                </p>
              )}
              {active?.pendingCompletion && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void retryCompletionSync()}
                    disabled={isTransitioning}
                    className="rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white hover:bg-primary-strong disabled:opacity-40"
                  >
                    Повторить синхронизацию
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCompletionRecovery(true)}
                    disabled={isTransitioning}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-40"
                  >
                    Вернуть в корзину
                  </button>
                </div>
              )}
              {active && (
                <button
                  type="button"
                  onClick={() => setShowUnknownPurchase(true)}
                  disabled={isOrderLocked}
                  className="absolute right-0 top-0 grid size-10 place-items-center rounded-xl bg-amber-400 text-2xl font-bold text-amber-950 shadow-sm hover:bg-amber-500 disabled:opacity-40"
                  aria-label="Добавить неизвестную покупку"
                  title="Неизвестная покупка (Q)"
                >
                  +
                </button>
              )}
              {showTables && active?.serviceLocation !== "takeaway" && (
                <TableMap
                  map={tableMap}
                  freeTables={freeTables}
                  onSelect={assignTable}
                />
              )}
            </div>
            {!active ? (
              <p className="py-16 text-center text-sm text-slate-500">
                Выберите или создайте новый заказ
              </p>
            ) : (
              <>
                <ul className="my-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {active.items.length === 0 ? (
                    <li className="py-10 text-center text-sm text-slate-500">
                      Добавьте блюда из каталога
                    </li>
                  ) : (
                    active.items.map((item) => (
                      <OrderCard
                        key={item.id}
                        item={item}
                        disabled={isOrderLocked}
                        canChangeQuantity
                        isSentToKitchen={item.menuItemId !== null && item.preparesInKitchen && item.sentQuantity >= item.quantity}
                        onDecrease={() => subtractItem(item)}
                        onIncrease={() => {
                          if (active && item.menuItemId)
                            queueItemChange(
                              active.id,
                              selectOrderItem(item),
                              1,
                            );
                          else if (item.menuItemId === null)
                            changeUnknownPurchaseQuantity(item, 1);
                        }}
                        onRemove={() => void removeItem(item)}
                        onComment={item.menuItemId && item.preparesInKitchen && item.sentQuantity === 0 ? () => { setCommentItem(item); setCommentDraft(item.kitchenComment ?? ""); } : undefined}
                        onSend={item.menuItemId && item.preparesInKitchen ? () =>
                          void printLocalItemsToKitchen(
                            [item],
                            `${item.itemName} передано на печатную станцию. Корзина не изменена.`,
                          ) : undefined}
                      />
                    ))
                  )}
                </ul>
                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                  <div>
                    <span className="block text-slate-500">Позиций</span>
                    <strong className="text-lg">{itemCount}</strong>
                  </div>
                  <div>
                    <span className="block text-slate-500">Сумма заказа</span>
                    <strong className="text-lg">
                      {formatSom(activeTotalTyiyn)}
                    </strong>
                  </div>
                </div>
                {active.items.some((item) => item.menuItemId !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasPendingKitchenItems && active.hasKitchenTicket) {
                        setShowKitchenRepeatConfirm(true);
                        return;
                      }
                      void printLocalItemsToKitchen(
                        active.items,
                        "Новые блюда переданы на печатную станцию. Корзина не изменена.",
                      );
                    }}
                    disabled={isOrderLocked || !active.items.some((item) => item.menuItemId !== null && item.preparesInKitchen)}
                    className={`mt-4 w-full rounded-2xl border px-4 py-3 text-sm font-bold disabled:opacity-40 ${active.hasKitchenTicket && !hasPendingKitchenItems ? "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200" : "border-primary bg-teal-50 text-primary-strong hover:bg-teal-100"}`}
                  >
                    {!active.items.some((item) => item.menuItemId !== null && item.preparesInKitchen)
                      ? "Нет блюд для кухни"
                      : active.hasKitchenTicket && !hasPendingKitchenItems
                      ? "Уже отправлено на кухню"
                      : "Отправить новые блюда на кухню"}
                  </button>
                )}
                {active.items.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => void deleteEmptyOrder()}
                    disabled={isOrderLocked || activeTotalTyiyn <= 0}
                    className="mt-4 w-full rounded-2xl bg-red-500 px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(239,68,68,0.2)] hover:bg-red-600 disabled:opacity-40"
                  >
                    Удалить заказ
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void completeOrder()}
                    disabled={isOrderLocked}
                    className={`mt-4 w-full rounded-2xl px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(17,170,160,0.2)] disabled:opacity-70 ${active.completedAt ? "bg-emerald-600" : "bg-primary"}`}
                  >
                    {active.completedAt ? "Заказ завершён" : "Завершить заказ"}
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
      {showTakeawayConfirm && active && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="takeaway-confirm-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="takeaway-confirm-title" className="text-lg font-bold text-slate-950">Перевести заказ на вынос?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Стол {active.tableNumber} будет освобождён. После первой отправки на кухню режим заказа изменить нельзя.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowTakeawayConfirm(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => { setShowTakeawayConfirm(false); changeServiceLocation("takeaway", true); }} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-500">На вынос</button>
            </div>
          </div>
        </div>
      )}
      {showCompletionRecovery && active?.pendingCompletion && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="completion-recovery-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="completion-recovery-title" className="text-lg font-bold text-slate-950">Вернуть заказ в корзину?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Клиентский чек уже напечатан. Заказ снова станет доступен для исправления, но чек повторно не будет печататься. После исправления нажмите «Завершить заказ», чтобы сохранить его на сервере.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCompletionRecovery(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Оставить как есть</button>
              <button type="button" onClick={returnPendingCompletionToCart} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-500">Вернуть в корзину</button>
            </div>
          </div>
        </div>
      )}
      {kitchenCancellationItem && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kitchen-cancellation-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="kitchen-cancellation-title" className="text-lg font-bold text-slate-950">
              Отменить блюдо на кухне?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              «{kitchenCancellationItem.itemName}» уже отправлено на кухню. После подтверждения будет сразу напечатан отдельный кухонный чек с надписью «ОТМЕНА», затем блюдо исчезнет из заказа.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setKitchenCancellationItem(null)}
                disabled={isTransitioning}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Не отменять
              </button>
              <button
                type="button"
                onClick={() => void confirmKitchenCancellation()}
                disabled={isTransitioning}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
              >
                Напечатать отмену
              </button>
            </div>
          </div>
        </div>
      )}
      {showKitchenRepeatConfirm && active && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="repeat-kitchen-print-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="repeat-kitchen-print-title" className="text-lg font-bold text-slate-950">
              Отправить на кухню повторно?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Этот заказ уже был отправлен на кухню. Подтвердите повторную печать, чтобы кухня не получила дубликат по ошибке.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowKitchenRepeatConfirm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowKitchenRepeatConfirm(false);
                  void printLocalItemsToKitchen(
                    active.items,
                    "Блюда повторно переданы на печатную станцию. Корзина не изменена.",
                    true,
                  );
                }}
                className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-500"
              >
                Отправить повторно
              </button>
            </div>
          </div>
        </div>
      )}
      {variantPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="variant-picker-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="variant-picker-title" className="text-lg font-bold text-slate-950">
              {variantPicker.item.name}: выберите характеристику
            </h2>
            <div className="mt-5 flex flex-col gap-2">
              {variantPicker.item.variants.map((variant, index) => (
                <button
                  type="button"
                  key={variant.id}
                  onClick={() => {
                    addItem(variantPicker.item, variant);
                    if ((activeOrderRef.current?.serviceLocation ?? "hall") === "takeaway" && !variantPicker.item.isContainer) offerContainer();
                    setVariantPicker(null);
                  }}
                  className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${variantButtonStyles[index % variantButtonStyles.length]}`}
                >
                  <span className="truncate">{variant.name}</span>
                  <span className="shrink-0 text-base font-bold">{formatSom(variant.priceTyiyn)}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={() => setVariantPicker(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {containerPrompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="container-prompt-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="container-prompt-title" className="text-lg font-bold text-slate-950">Добавить контейнер?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">К блюду на вынос можно добавить контейнер.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setContainerPrompt(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Нет</button>
              <button type="button" onClick={() => { setContainerPicker(containerPrompt); setContainerPrompt(null); }} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-500">Да</button>
            </div>
          </div>
        </div>
      )}
      {containerPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="container-picker-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="container-picker-title" className="text-lg font-bold text-slate-950">{containerPicker.name}: выберите характеристику</h2>
            <div className="mt-5 flex flex-col gap-2">
              {containerPicker.variants.map((variant, index) => (
                <button type="button" key={variant.id} onClick={() => { addItem(containerPicker, variant); setContainerPicker(null); }} className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${variantButtonStyles[index % variantButtonStyles.length]}`}>
                  <span className="truncate">{variant.name}</span><span className="shrink-0 text-base font-bold">{formatSom(variant.priceTyiyn)}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setContainerPicker(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Отмена</button></div>
          </div>
        </div>
      )}
      {commentItem && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="kitchen-comment-title">
          <form onSubmit={(event) => { event.preventDefault(); saveKitchenComment(); }} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="kitchen-comment-title" className="text-lg font-bold text-slate-950">Комментарий для кухни</h2>
            <p className="mt-1 text-sm text-slate-600">{displayItemName(commentItem.itemName)}</p>
            <textarea autoFocus value={commentDraft} onChange={(event) => setCommentDraft(event.target.value.slice(0, 280))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveKitchenComment(); } }} maxLength={280} rows={3} placeholder="Например, один упаковать с собой" className="mt-4 w-full resize-none rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-primary" />
            <p className="mt-1 text-right text-xs text-slate-400">{commentDraft.length}/280</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => { setCommentItem(null); setCommentDraft(""); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Отмена</button>
              <button className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-strong">Сохранить</button>
            </div>
          </form>
        </div>
      )}
      {showUnknownPurchase && active && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="unknown-purchase-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addUnknownPurchase();
            }}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 id="unknown-purchase-title" className="text-lg font-bold text-slate-950">Неизвестная покупка</h2>
            <p className="mt-2 text-sm text-slate-600">Введите сумму в сомах. Эта позиция попадёт в клиентский чек, но не будет отправлена на кухню.</p>
            <label className="mt-5 block text-sm font-semibold text-slate-700">
              Сумма
              <input
                autoFocus
                inputMode="numeric"
                value={unknownPurchaseAmount}
                onChange={(event) => {
                  const amount = event.target.value;
                  if (/^\d*$/.test(amount)) setUnknownPurchaseAmount(amount);
                }}
                pattern="[0-9]*"
                placeholder="Например, 250"
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-semibold outline-none focus:border-primary"
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowUnknownPurchase(false); setUnknownPurchaseAmount(""); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Отмена</button>
              <button className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-500">Добавить</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

type OrderCardProps = {
  item: ActiveOrder["items"][number];
  disabled: boolean;
  canChangeQuantity: boolean;
  isSentToKitchen: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onRemove: () => void;
  onComment?: () => void;
  onSend?: () => void;
};

function OrderCard({
  item,
  disabled,
  canChangeQuantity,
  isSentToKitchen,
  onDecrease,
  onIncrease,
  onRemove,
  onComment,
  onSend,
}: OrderCardProps) {
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 pr-24 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(8rem,auto)_auto]">
      {onSend && <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className={`absolute right-9 top-2 grid size-6 place-items-center rounded-md border text-sm font-bold disabled:opacity-40 ${isSentToKitchen ? "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200" : "border-primary/25 bg-teal-50 text-primary-strong hover:bg-teal-100"}`}
        aria-label={isSentToKitchen ? `Блюдо ${item.itemName} уже отправлено на кухню` : `Отправить ${item.itemName} на кухню`}
        title={isSentToKitchen ? "Уже напечатано на кухне" : "Отправить на кухню"}
      >
        ↗
      </button>}
      {onComment && <button
        type="button"
        onClick={onComment}
        disabled={disabled}
        className="absolute right-[4.5rem] top-1 grid size-8 place-items-center rounded-lg bg-amber-300 text-base shadow-sm hover:bg-amber-400 disabled:opacity-40"
        aria-label={`Добавить комментарий к блюду ${item.itemName}`}
        title="Комментарий для кухни"
      >
        💬
      </button>}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Удалить ${item.itemName} из заказа`}
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-35"
      >
        ×
      </button>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400">Блюдо</p>
        <h3 className="truncate text-sm font-bold">{displayItemName(item.itemName)}</h3>
        {item.kitchenComment && <p className="mt-0.5 truncate text-xs text-slate-500">Комментарий: {item.kitchenComment}</p>}
        <p className="mt-0.5 text-xs text-slate-500">
          {formatSom(item.unitPriceTyiyn)} × {item.quantity}
        </p>
      </div>
      <div className="text-right sm:text-left">
        <p className="text-[11px] font-medium text-slate-400">Сумма</p>
        <p className="font-bold text-slate-800">
          {formatSom(item.lineTotalTyiyn)}
        </p>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:block">
        <p className="text-[11px] font-medium text-slate-400">Количество</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-xl border border-slate-200">
            <QuantityButton
              label={`Уменьшить ${item.itemName}`}
              disabled={disabled || !canChangeQuantity}
              onClick={onDecrease}
            >
              −
            </QuantityButton>
            <span className="grid min-w-10 place-items-center font-bold">
              {item.quantity}
            </span>
            <QuantityButton
              label={`Увеличить ${item.itemName}`}
              disabled={disabled || !canChangeQuantity}
              onClick={onIncrease}
            >
              +
            </QuantityButton>
          </div>
        </div>
      </div>
      <div className="col-span-2 text-right sm:col-span-1 sm:text-left">
        <p className="text-[11px] font-medium text-slate-400">Время</p>
        <p className="text-sm font-medium text-slate-600">
          {formatOrderTime(item.addedAt)}
        </p>
      </div>
    </li>
  );
}

function TableMap({
  map,
  freeTables,
  onSelect,
}: {
  map: TableMapResponse["data"];
  freeTables: number[];
  onSelect: (table: number) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-2 w-[min(24rem,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
      <p className="mb-2 text-xs text-slate-500">Выберите свободный стол</p>
      <TableGrid
        cells={map.cells}
        rows={map.rows}
        columns={map.columns}
        freeTables={freeTables}
        onSelect={onSelect}
      />
    </div>
  );
}

function CategoryButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  const style = active
    ? "bg-primary text-white"
    : "bg-surface-muted text-slate-700 hover:bg-teal-100";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${style}`}
    >
      {children}
    </button>
  );
}

function QuantityButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 place-items-center text-lg font-bold text-primary hover:bg-teal-50 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Toast({
  children,
  kind,
  onClose,
}: {
  children: string;
  kind: "success" | "error";
  onClose: () => void;
}) {
  const style =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-teal-200 bg-white text-teal-900";
  const iconStyle =
    kind === "error" ? "bg-red-500 text-white" : "bg-primary text-white";

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border p-4 shadow-xl transition-all duration-300 ease-out ${style}`}
    >
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${iconStyle}`}
      >
        {kind === "error" ? "!" : "✓"}
      </span>
      <p className="flex-1 text-sm font-medium leading-5">{children}</p>
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
        aria-label="Закрыть уведомление"
      >
        ×
      </button>
    </div>
  );
}
function orderTitle(order: ActiveOrderSummary) {
  if (order.tableNumber) return `С ${order.tableNumber}`;
  return order.orderNumber > 0 ? `З №${order.orderNumber}` : "…";
}
function activeTitle(order: ActiveOrder) {
  return order.tableNumber ? `Стол ${order.tableNumber}` : "Новый заказ";
}
function displayItemName(value: string) {
  return value.replace(/\s*·\s*(?:Зал|На вынос)\s*$/iu, "");
}
function toLocalCustomerReceipt(order: CachedPosOrder): CreatedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber,
    serviceLocation: order.serviceLocation,
    totalTyiyn: calculateCartTotal(order.items),
    cashierName: order.cashierName,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      menuItemId: item.menuItemId,
      serviceLocation: item.serviceLocation,
      itemName: item.itemName,
      kitchenComment: item.kitchenComment,
      unitPriceTyiyn: item.unitPriceTyiyn,
      quantity: item.quantity,
      lineTotalTyiyn: item.lineTotalTyiyn,
    })),
    printJobs: [],
    created: false,
  };
}
function toLocalKitchenReceipt(
  order: CachedPosOrder,
  sourceItems: ActiveOrder["items"],
  printItems: PendingKitchenPrint["items"],
): CreatedOrder {
  const items = printItems.map((printItem) => {
    const source = sourceItems.find((item) => item.menuItemId === printItem.menuItemId && item.menuItemVariantId === printItem.menuItemVariantId && item.serviceLocation === printItem.serviceLocation && (item.kitchenComment ?? null) === (printItem.kitchenComment ?? null));
    if (!source) throw new Error("Не удалось подготовить локальный кухонный чек.");
    return { menuItemId: source.menuItemId, serviceLocation: printItem.serviceLocation, itemName: source.itemName, kitchenComment: source.kitchenComment, unitPriceTyiyn: source.unitPriceTyiyn, quantity: printItem.quantity, lineTotalTyiyn: source.unitPriceTyiyn * printItem.quantity };
  });
  return { id: order.id, orderNumber: order.orderNumber, tableNumber: order.tableNumber, serviceLocation: order.serviceLocation, totalTyiyn: items.reduce((sum, item) => sum + item.lineTotalTyiyn, 0), cashierName: order.cashierName, createdAt: order.createdAt, items, printJobs: [], created: false };
}
function selectMenuItem(
  item: MenuItem,
  variant: MenuItem["variants"][number] | undefined,
  serviceLocation?: "hall" | "takeaway",
): SelectedMenuItem {
  const itemName = variant && item.variants.length > 1 ? `${item.name} · ${variant.name}` : item.name;
  return {
    ...item,
    priceTyiyn: variant?.priceTyiyn ?? item.priceTyiyn,
    selectedVariantId: variant?.id ?? null,
    serviceLocation,
    displayName: itemName,
    kitchenComment: null,
  };
}
function selectOrderItem(item: ActiveOrder["items"][number]): SelectedMenuItem {
  if (!item.menuItemId) throw new Error("У неизвестной покупки нельзя менять количество.");
  return {
    id: item.menuItemId,
    categoryId: "",
    name: item.itemName,
    priceTyiyn: item.unitPriceTyiyn,
    isQuick: false,
    requiresServiceLocation: false,
    preparesInKitchen: item.preparesInKitchen,
    isContainer: false,
    variants: [],
    selectedVariantId: item.menuItemVariantId,
    serviceLocation: item.serviceLocation,
    displayName: displayItemName(item.itemName),
    targetLineId: item.sentQuantity === 0 ? item.id : undefined,
    kitchenComment: item.kitchenComment ?? null,
  };
}
function toActiveOrderSummary(order: ActiveOrder): ActiveOrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber,
    serviceLocation: order.serviceLocation,
    totalTyiyn: order.totalTyiyn,
    cashierName: order.cashierName,
    createdAt: order.createdAt,
  };
}
function formatOrderTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));
}
function parseSomAmount(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000 ? amount : null;
}
function readCachedMenu(): MenuCatalog | null {
  try {
    const cached = window.sessionStorage.getItem(menuCacheKey);
    if (!cached) return null;
    const value: unknown = JSON.parse(cached);
    if (
      !value ||
      typeof value !== "object" ||
      !("savedAt" in value) ||
      !("data" in value) ||
      typeof value.savedAt !== "number" ||
      Date.now() - value.savedAt > menuCacheLifetimeMs
    )
      return null;
    const candidate = { data: value.data };
    return isMenuResponse(candidate) ? candidate.data : null;
  } catch {
    return null;
  }
}
function writeCachedMenu(data: MenuCatalog) {
  try {
    window.sessionStorage.setItem(
      menuCacheKey,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    /* Storage can be disabled; the live response still renders. */
  }
}
function readMenuRevision() {
  try {
    return window.localStorage.getItem(menuRevisionKey) ?? "initial";
  } catch {
    return "initial";
  }
}
function isMenuResponse(value: unknown): value is MenuResponse {
  return Boolean(value && typeof value === "object" && "data" in value);
}
function isActiveOrdersResponse(value: unknown): value is ActiveOrdersResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "data" in value &&
    Array.isArray(value.data),
  );
}
function isActiveOrderResponse(value: unknown): value is ActiveOrderResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "data" in value &&
    value.data &&
    typeof value.data === "object" &&
    "tableNumber" in value.data,
  );
}
function isPrintableResponse(value: unknown): value is PrintableResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "data" in value &&
    value.data &&
    typeof value.data === "object" &&
    "printJobs" in value.data,
  );
}
function isShiftDashboardResponse(value: unknown): value is { data: ShiftDashboard } {
  return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "currentShift" in value.data && "shifts" in value.data);
}
function isCashShiftResponse(value: unknown): value is { data: CashShift } {
  return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "businessDate" in value.data && "status" in value.data);
}
function isAutoCloseStaleShiftResponse(value: unknown): value is AutoCloseStaleShiftResponse {
  return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "outcome" in value.data && "shift" in value.data);
}
function isTableMapResponse(value: unknown): value is TableMapResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "data" in value &&
    value.data &&
    typeof value.data === "object" &&
    "cells" in value.data &&
    Array.isArray(value.data.cells),
  );
}
function message(value: unknown, fallback: string) {
  if (
    !value ||
    typeof value !== "object" ||
    !("error" in value) ||
    !value.error ||
    typeof value.error !== "object" ||
    !("message" in value.error) ||
    typeof value.error.message !== "string"
  )
    return fallback;
  return value.error.message;
}
function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "short" }).format(new Date(`${value}T00:00:00+06:00`));
}
