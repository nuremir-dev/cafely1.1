"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addItem,
  clearCart,
  decreaseItem,
  increaseItem,
  removeItem,
} from "./cart";
import type { CartItem, CartMenuItem } from "./types";

const CART_STORAGE_KEY = "cafeline:cart:v1";
const STORAGE_WRITE_DELAY_MS = 200;

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.menuItemId === "string" &&
    typeof item.name === "string" &&
    Number.isInteger(item.priceTyiyn) &&
    typeof item.priceTyiyn === "number" &&
    item.priceTyiyn >= 0 &&
    Number.isInteger(item.quantity) &&
    typeof item.quantity === "number" &&
    item.quantity >= 1
  );
}

function readStoredCart(): CartItem[] {
  try {
    const rawCart = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!rawCart) return [];
    const parsedCart: unknown = JSON.parse(rawCart);
    return Array.isArray(parsedCart) && parsedCart.every(isCartItem) ? parsedCart : [];
  } catch {
    return [];
  }
}

export function useLocalCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const latestItemsRef = useRef(items);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const storedItems = readStoredCart();
    latestItemsRef.current = storedItems;
    hydratedRef.current = true;
    // Defer the client-only restore until after hydration. This preserves the
    // server-rendered empty-cart markup and avoids a synchronous effect update.
    const timeout = window.setTimeout(() => setItems(storedItems), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    latestItemsRef.current = items;
    if (!hydratedRef.current) return;

    const writeCart = () => {
      try {
        window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(latestItemsRef.current));
      } catch {
        // The POS must remain usable when browser storage is unavailable.
      }
    };
    const timeout = window.setTimeout(writeCart, STORAGE_WRITE_DELAY_MS);
    const flushOnPageExit = () => writeCart();
    window.addEventListener("pagehide", flushOnPageExit);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", flushOnPageExit);
    };
  }, [items]);

  return {
    items,
    add: useCallback((item: CartMenuItem) => setItems((current) => addItem(current, item)), []),
    increase: useCallback(
      (menuItemId: string) => setItems((current) => increaseItem(current, menuItemId)),
      [],
    ),
    decrease: useCallback(
      (menuItemId: string) => setItems((current) => decreaseItem(current, menuItemId)),
      [],
    ),
    remove: useCallback(
      (menuItemId: string) => setItems((current) => removeItem(current, menuItemId)),
      [],
    ),
    clear: useCallback(() => {
      setItems(clearCart());
      try {
        window.localStorage.removeItem(CART_STORAGE_KEY);
      } catch {
        // Clearing a completed order must not fail because browser storage failed.
      }
    }, []),
  };
}
