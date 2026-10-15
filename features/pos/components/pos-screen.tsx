"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatSom } from "@/features/cart/cart";
import type { MenuCatalog } from "@/features/menu/types";
import type { CreatedOrder } from "@/features/orders/types";
import type {
  ActiveOrder,
  ActiveOrderSummary,
} from "@/features/orders/server/active-orders";
import { readPosCache, type CachedPosOrder, writePosCache } from "@/features/pos/local-pos-cache";
import { getPrintStationId, printCustomerReceiptSnapshot, printOrder } from "@/features/printing/qz-client";
import type { CashShift, ShiftDashboard } from "@/features/shifts/types";
import { TableGrid } from "@/features/tables/components/table-grid";

type MenuResponse = { data: MenuCatalog };
type ActiveOrdersResponse = { data: ActiveOrder[] };
type ActiveOrderResponse = { data: ActiveOrder };
type PrintableResponse = { data: CreatedOrder };
type ClaimResponse = { data: boolean };
type TableMapResponse = {
  data: { cells: number[]; rows: number; columns: number };
};
type MenuItem = MenuCatalog["categories"][number]["items"][number];
type SelectedMenuItem = MenuItem & {
  selectedVariantId: string | null;
  serviceLocation?: "hall" | "takeaway";
  displayName: string;
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
  const [cacheReady, setCacheReady] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showKitchenRepeatConfirm, setShowKitchenRepeatConfirm] = useState(false);
  const [showUnknownPurchase, setShowUnknownPurchase] = useState(false);
  const [unknownPurchaseAmount, setUnknownPurchaseAmount] = useState("");
  const [locationPickerItemId, setLocationPickerItemId] = useState<string | null>(null);
  const [variantPicker, setVariantPicker] = useState<{ item: MenuItem; serviceLocation: "hall" | "takeaway" } | null>(null);
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
      cachedOrdersRef.current = restored;
      setCachedOrders(restored);
      setOrders(cache.summaries);
      const selected = cache.activeOrderId ? restored[cache.activeOrderId] : cache.orders[0];
      if (selected) {
        activeOrderRef.current = selected;
        setActive(selected);
      }
    }).finally(() => setCacheReady(true));
  }, []);

  useEffect(() => {
    void fetch("/api/shifts", { cache: "no-store" })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !isShiftDashboardResponse(payload))
          throw new Error(message(payload, "Не удалось проверить смену."));
        setCashShift(payload.data.currentShift);
      })
      .catch((cause) => {
        setShiftError(cause instanceof Error ? cause.message : "Не удалось проверить смену.");
        setCashShift(null);
      });
  }, []);

  useEffect(() => {
    const cached = Object.values(cachedOrders);
    if (cached.length === 0) return;
    void writePosCache({ version: 1, activeOrderId: active?.id ?? null, orders: cached, summaries: orders, savedAt: Date.now() });
  }, [active?.id, cachedOrders, orders]);

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
          syncState: "synced" as const,
        };
      });
      const localOnly = Object.values(cachedOrdersRef.current).filter((order) => order.syncState !== "synced");
      const nextOrders = [...incoming, ...localOnly];
      const nextCache = Object.fromEntries(nextOrders.map((order) => [order.id, order]));
      cachedOrdersRef.current = nextCache;
      setCachedOrders(nextCache);
      setOrders(nextOrders.map(toActiveOrderSummary));
      const id =
        preferredId && nextCache[preferredId]
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
      else setActive(null);
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
        body: JSON.stringify({ idempotencyKey: draft.syncKey, tableNumber: draft.tableNumber }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isActiveOrderResponse(payload)) throw new Error(message(payload, "Не удалось синхронизировать заказ."));
      const synced: CachedPosOrder = {
        ...payload.data,
        items: (cachedOrdersRef.current[draft.id] ?? draft).items,
        totalTyiyn: (cachedOrdersRef.current[draft.id] ?? draft).totalTyiyn,
        tableNumber: (cachedOrdersRef.current[draft.id] ?? draft).tableNumber,
        hasKitchenTicket: (cachedOrdersRef.current[draft.id] ?? draft).hasKitchenTicket,
        customerReceiptPrintedAt: (cachedOrdersRef.current[draft.id] ?? draft).customerReceiptPrintedAt,
        pendingCompletion: (cachedOrdersRef.current[draft.id] ?? draft).pendingCompletion,
        completionSyncError: (cachedOrdersRef.current[draft.id] ?? draft).completionSyncError,
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
            ...(item.menuItemId === null ? { adHocAmountTyiyn: item.unitPriceTyiyn } : {}),
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload))
        throw new Error(message(payload, "Не удалось синхронизировать завершённый заказ."));
      const remaining = { ...cachedOrdersRef.current };
      delete remaining[draft.id];
      delete remaining[order.id];
      cachedOrdersRef.current = remaining;
      setCachedOrders(remaining);
      setOrders((current) => current.filter((summary) => summary.id !== draft.id && summary.id !== order.id));
      if (activeOrderRef.current?.id === draft.id || activeOrderRef.current?.id === order.id) {
        activeOrderRef.current = null;
        setActive(null);
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
  useEffect(() => {
    const synchronizePendingOrders = () => {
      for (const order of Object.values(cachedOrdersRef.current)) {
        if (order.pendingCompletion && order.customerReceiptPrintedAt) {
          void completePrintedOrder(order).catch(() => undefined);
          continue;
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
  }, [completePrintedOrder, syncLocalOrder, syncTableAssignment]);
  const createOrder = useCallback(async () => {
    if (isCreating) return;
    activeOrderRevision.current += 1;
    const localOrderId = `local-order-${crypto.randomUUID()}`;
    const localOrder: CachedPosOrder = {
      id: localOrderId,
      orderNumber: 0,
      tableNumber: null,
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
    setIsCreating(true);
    setNotice(null);
    setShowTables(false);
    setNotice("Новый заказ создан локально.");
    setError(null);
    setIsCreating(false);
    window.setTimeout(() => void syncLocalOrder(localOrder).catch(() => undefined), 750);
  }, [isCreating, syncLocalOrder]);
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
  async function assignTable(tableNumber: number) {
    if (!active || active.pendingCompletion || isTransitioning) return;
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
  function addItem(item: MenuItem, variant: MenuItem["variants"][number] | undefined, serviceLocation?: "hall" | "takeaway") {
    if (!active || active.pendingCompletion) return;
    queueItemChange(active.id, selectMenuItem(item, variant, serviceLocation), 1);
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
      fulfillmentType: "counter",
    };
    setActive((current) => {
      if (!current) return current;
      const next = { ...current, items: [unknownItem, ...current.items], totalTyiyn: current.totalTyiyn + amountTyiyn };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      return next;
    });
    setOrders((current) => current.map((order) => order.id === active.id ? { ...order, totalTyiyn: order.totalTyiyn + amountTyiyn } : order));
    setUnknownPurchaseAmount("");
    setShowUnknownPurchase(false);
    setNotice("Неизвестная покупка добавлена в заказ.");
  }
  function subtractItem(item: ActiveOrder["items"][number]) {
    if (!active || active.pendingCompletion) return;
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
      const next = { ...current, items, totalTyiyn: Math.max(0, current.totalTyiyn + item.unitPriceTyiyn * delta) };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      return next;
    });
    setOrders((current) => current.map((order) => order.id === orderId
      ? { ...order, totalTyiyn: Math.max(0, order.totalTyiyn + item.unitPriceTyiyn * delta) }
      : order));
  }
  async function removeItem(item: ActiveOrder["items"][number]) {
    if (!active || active.pendingCompletion || isTransitioning) return;
    if (item.menuItemId === null) {
      const orderId = active.id;
      const removeUnknownItem = (order: CachedPosOrder) => ({
        ...order,
        items: order.items.filter((candidate) => candidate.id !== item.id),
        totalTyiyn: Math.max(0, order.totalTyiyn - item.lineTotalTyiyn),
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
      let order = active;
      if (order.syncState !== "synced") order = await syncLocalOrder(order);
      const response = await fetch(`/api/active-orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "print-local-cart-to-kitchen",
          idempotencyKey: crypto.randomUUID(),
          items: kitchenItems.map((item) => ({
            menuItemId: item.menuItemId,
            menuItemVariantId: item.menuItemVariantId,
            quantity: repeat ? item.quantity : item.quantity - item.sentQuantity,
            serviceLocation: item.serviceLocation ?? "hall",
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isPrintableResponse(payload))
        throw new Error(
          message(payload, "Не удалось передать блюда на кухню."),
        );
      const printed = await printCreatedOrderLocally(payload.data);
      if (!printed) throw new Error("Блюдо сохранено для кухни, но не удалось напечатать чек.");
      setNotice(successMessage);
      setActive((current) => {
        if (current?.id !== order.id) return current;
        const sentItemIds = new Set(kitchenItems.map((item) => item.id));
        const next = {
          ...current,
          hasKitchenTicket: true,
          items: current.items.map((item) =>
            sentItemIds.has(item.id) ? { ...item, sentQuantity: item.quantity } : item,
          ),
        };
        activeOrderRef.current = next;
        cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
        setCachedOrders(cachedOrdersRef.current);
        return next;
      });
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось передать блюда на кухню.",
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
    setActive((current) => {
      if (!current || current.id !== orderId) return current;
      const pendingIndex = current.items.findIndex(
        (line) =>
          line.menuItemId === item.id &&
          line.menuItemVariantId === item.selectedVariantId &&
          line.serviceLocation === item.serviceLocation &&
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
            fulfillmentType: item.fulfillmentType,
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
        totalTyiyn: Math.max(0, current.totalTyiyn + item.priceTyiyn * delta),
      };
      activeOrderRef.current = next;
      cachedOrdersRef.current = { ...cachedOrdersRef.current, [next.id]: next };
      setCachedOrders(cachedOrdersRef.current);
      return next;
    });
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? {
              ...order,
              totalTyiyn: Math.max(
                0,
                order.totalTyiyn + item.priceTyiyn * delta,
              ),
            }
          : order,
      ),
    );
  }
  async function completeOrder() {
    if (
      !active ||
      active.items.length === 0 ||
      active.pendingCompletion ||
      isTransitioning
    )
      return;
    activeOrderRevision.current += 1;
    let order = active;
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
  async function printCreatedOrderLocally(order: CreatedOrder): Promise<boolean> {
    const job = order.printJobs[0];
    if (!job) return false;
    const stationId = getPrintStationId();
    try {
      const response = await fetch(`/api/print-jobs/${job.id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stationId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isClaimResponse(payload) || !payload.data) return false;
      let printed = false;
      await printOrder(order, async (printJob, status, lastError) => {
        const report = await fetch(`/api/print-jobs/${printJob.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, lastError: lastError ?? null, stationId }),
        });
        if (!report.ok) throw new Error("Не удалось сохранить результат печати.");
        printed = status === "submitted";
      }, job.type, job.id);
      return printed;
    } catch {
      // The claimed job remains available for the configured fallback station
      // once its short processing lease expires.
      return false;
    }
  }
  async function deleteEmptyOrder() {
    if (
      !active ||
      active.items.length > 0 ||
      active.pendingCompletion ||
      isTransitioning
    )
      return;
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
  const hasPendingKitchenItems =
    active?.items.some(
      (item) => item.menuItemId !== null && item.sentQuantity < item.quantity,
    ) ?? false;
  const isOrderLocked = isTransitioning || Boolean(active?.pendingCompletion);
  const orderedOrders = useMemo(
    () => [...orders].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [orders],
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
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5 pr-0.5">
          {orderedOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => void selectOrder(order.id)}
              disabled={isTransitioning}
              className={`min-w-24 rounded-xl border px-3 py-2 text-left text-sm transition ${active?.id === order.id ? "border-primary bg-teal-50" : "border-slate-200 bg-white hover:border-primary"}`}
            >
              <strong className="block text-slate-900">
                {orderTitle(order)}
              </strong>
            </button>
          ))}
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

      <div className="pointer-events-none fixed right-4 top-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
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
                  const choosingLocation = locationPickerItemId === item.id;
                  const chooseCard = () => {
                    if (!active || active.pendingCompletion) return;
                    if (!item.requiresServiceLocation) {
                      addItem(item, undefined);
                      return;
                    }
                    setLocationPickerItemId((current) =>
                        current === item.id ? null : item.id,
                      );
                  };
                  const chooseLocation = (serviceLocation: "hall" | "takeaway") => {
                    setLocationPickerItemId(null);
                    if (hasMultipleVariants) {
                      setVariantPicker({ item, serviceLocation });
                      return;
                    }
                    addItem(item, singleVariant, serviceLocation);
                  };
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={active && !active.pendingCompletion ? 0 : -1}
                      aria-expanded={choosingLocation}
                      onClick={chooseCard}
                      onKeyDown={(event) => {
                        if (
                          (event.key === "Enter" || event.key === " ") &&
                          active
                        ) {
                          event.preventDefault();
                          chooseCard();
                        }
                      }}
                      className={`min-h-22 cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-px hover:border-primary hover:bg-teal-50 ${!active ? "cursor-not-allowed opacity-40" : ""}`}
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
                            <span className="mt-0.5 text-xs">{choosingLocation ? "⌃" : "⌄"}</span>
                          </span>
                        ) : (
                          <span className="mt-2 block text-base font-bold text-primary-strong">
                            {formatSom(
                              singleVariant?.priceTyiyn ?? item.priceTyiyn,
                            )}
                          </span>
                        )}
                      </div>
                      {choosingLocation && (
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3" onClick={(event) => event.stopPropagation()}>
                          <button type="button" onClick={() => chooseLocation("hall")} className="rounded-xl bg-emerald-100 px-2 py-2.5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200">
                            Зал
                          </button>
                          <button type="button" onClick={() => chooseLocation("takeaway")} className="rounded-xl bg-amber-100 px-2 py-2.5 text-sm font-bold text-amber-950 transition hover:bg-amber-200">
                            На вынос
                          </button>
                        </div>
                      )}
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
              <button
                type="button"
                onClick={() => setShowTables((value) => !value)}
                disabled={!active || isOrderLocked}
                className="flex items-center gap-2 text-left text-xl font-bold tracking-[-0.04em] text-slate-950 disabled:opacity-50"
              >
                {active ? activeTitle(active) : "Активный заказ"}
                <span className="text-base text-primary">⌄</span>
              </button>
              {active && (
                <p className="mt-1 text-sm text-slate-500">
                  {active.pendingCompletion
                    ? `Чек напечатан · ожидает синхронизации${active.completionSyncError ? `: ${active.completionSyncError}` : ""}`
                    : active.syncState === "local"
                    ? "Сохранён на устройстве"
                    : active.syncState === "syncing"
                      ? "Синхронизация…"
                      : active.syncState === "sync-error"
                        ? `Не синхронизировано: ${active.syncError ?? "повторим автоматически"}`
                        : `Заказ №${active.orderNumber} · открыт`}
                </p>
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
              {showTables && (
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
                        isSentToKitchen={item.menuItemId !== null && item.sentQuantity >= item.quantity}
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
                        onSend={item.menuItemId ? () =>
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
                      {formatSom(active.totalTyiyn)}
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
                    disabled={isOrderLocked}
                    className={`mt-4 w-full rounded-2xl border px-4 py-3 text-sm font-bold disabled:opacity-40 ${active.hasKitchenTicket && !hasPendingKitchenItems ? "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200" : "border-primary bg-teal-50 text-primary-strong hover:bg-teal-100"}`}
                  >
                    {active.hasKitchenTicket && !hasPendingKitchenItems
                      ? "Уже отправлено на кухню"
                      : "Отправить новые блюда на кухню"}
                  </button>
                )}
                {active.items.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => void deleteEmptyOrder()}
                    disabled={isOrderLocked}
                    className="mt-4 w-full rounded-2xl bg-red-500 px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(239,68,68,0.2)] hover:bg-red-600 disabled:opacity-40"
                  >
                    Удалить заказ
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void completeOrder()}
                    disabled={isOrderLocked}
                    className="mt-4 w-full rounded-2xl bg-primary px-4 py-4 text-base font-bold text-white shadow-[0_8px_18px_rgba(17,170,160,0.2)] disabled:opacity-40"
                  >
                    Завершить заказ
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
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
            <p className="mt-2 text-sm text-slate-600">
              Место: {variantPicker.serviceLocation === "hall" ? "зал" : "на вынос"}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {variantPicker.item.variants.map((variant, index) => (
                <button
                  type="button"
                  key={variant.id}
                  onClick={() => {
                    addItem(variantPicker.item, variant, variantPicker.serviceLocation);
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
  onSend,
}: OrderCardProps) {
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 pr-16 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(8rem,auto)_auto]">
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
        <h3 className="truncate font-bold">{item.itemName}</h3>
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
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl transition-all duration-300 ease-out ${style}`}
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
  return order.orderNumber > 0 ? `Заказ №${order.orderNumber}` : "Новый заказ";
}
function activeTitle(order: ActiveOrder) {
  return order.tableNumber ? `Стол ${order.tableNumber}` : "Новый заказ";
}
function toLocalCustomerReceipt(order: CachedPosOrder): CreatedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber,
    totalTyiyn: order.totalTyiyn,
    cashierName: order.cashierName,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      menuItemId: item.menuItemId,
      serviceLocation: item.serviceLocation,
      itemName: item.itemName,
      unitPriceTyiyn: item.unitPriceTyiyn,
      quantity: item.quantity,
      lineTotalTyiyn: item.lineTotalTyiyn,
    })),
    printJobs: [],
    created: false,
  };
}
function selectMenuItem(
  item: MenuItem,
  variant: MenuItem["variants"][number] | undefined,
  serviceLocation?: "hall" | "takeaway",
): SelectedMenuItem {
  const itemName = variant ? `${item.name} · ${variant.name}` : item.name;
  return {
    ...item,
    priceTyiyn: variant?.priceTyiyn ?? item.priceTyiyn,
    selectedVariantId: variant?.id ?? null,
    serviceLocation,
    displayName: serviceLocation ? `${itemName} · ${serviceLocation === "hall" ? "Зал" : "На вынос"}` : itemName,
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
    fulfillmentType: item.fulfillmentType,
    variants: [],
    selectedVariantId: item.menuItemVariantId,
    serviceLocation: item.serviceLocation,
    displayName: item.itemName,
  };
}
function toActiveOrderSummary(order: ActiveOrder): ActiveOrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber,
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
function isClaimResponse(value: unknown): value is ClaimResponse {
  return Boolean(value && typeof value === "object" && "data" in value && typeof value.data === "boolean");
}
function isShiftDashboardResponse(value: unknown): value is { data: ShiftDashboard } {
  return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "currentShift" in value.data && "shifts" in value.data);
}
function isCashShiftResponse(value: unknown): value is { data: CashShift } {
  return Boolean(value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object" && "businessDate" in value.data && "status" in value.data);
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
