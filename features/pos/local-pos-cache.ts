"use client";

import type { ActiveOrder, ActiveOrderItem, ActiveOrderSummary } from "@/features/orders/server/active-orders";

const databaseName = "cafeline-pos";
const storeName = "state";
const stateKey = "active-orders-v1";

export type PosSyncState = "local" | "syncing" | "synced" | "sync-error";
export type PendingKitchenPrint = {
  idempotencyKey: string;
  printedAt: string;
  /** Older cached entries have no kind and are regular kitchen tickets. */
  kind?: "new" | "cancellation";
  items: Array<{
    menuItemId: string;
    menuItemVariantId: string | null;
    quantity: number;
    serviceLocation: "hall" | "takeaway";
    kitchenComment?: string | null;
  }>;
};
export type CachedPosOrder = ActiveOrder & {
  syncState: PosSyncState;
  syncKey?: string;
  syncError?: string;
  pendingTableNumber?: number | null;
  pendingServiceLocation?: "hall" | "takeaway";
  pendingCommentLineIds?: string[];
  customerReceiptPrintedAt?: string;
  pendingCompletion?: boolean;
  completionSyncError?: string;
  pendingKitchenPrints?: PendingKitchenPrint[];
  completedAt?: string;
};
export type CompletedPosOrder = CachedPosOrder & { completedAt: string };
export type PosCache = {
  version: 1;
  activeOrderId: string | null;
  orders: CachedPosOrder[];
  completedOrders?: CompletedPosOrder[];
  summaries: ActiveOrderSummary[];
  savedAt: number;
};

/**
 * Reuse a draft before creating another empty POS tab. The browser cache is
 * authoritative here, because a local order can be editable before it has an
 * order number from the server.
 */
export function findReusableEmptyOrder(
  orders: Iterable<CachedPosOrder>,
): CachedPosOrder | null {
  return [...orders]
    .filter(
      (order) =>
        order.items.length === 0 &&
        !order.pendingCompletion &&
        !order.completedAt &&
        !order.customerReceiptPrintedAt,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null;
}

/** The total must always be derived from the actual cart lines, never from a separate delta. */
export function calculateCartTotal(items: ReadonlyArray<Pick<ActiveOrderItem, "lineTotalTyiyn">>): number {
  return items.reduce((total, item) => total + item.lineTotalTyiyn, 0);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readPosCache(): Promise<PosCache | null> {
  try {
    const database = await openDatabase();
    if (!database) return null;
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(stateKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("orders" in value) || !Array.isArray(value.orders)) return null;
    return value as PosCache;
  } catch {
    return null;
  }
}

export async function writePosCache(cache: PosCache): Promise<void> {
  try {
    const database = await openDatabase();
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, "readwrite").objectStore(storeName).put(cache, stateKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    database.close();
  } catch {
    // POS remains usable when browser storage is unavailable.
  }
}
