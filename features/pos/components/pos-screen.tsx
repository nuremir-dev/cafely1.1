"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatSom, getCartTotalTyiyn } from "@/features/cart/cart";
import { useLocalCart } from "@/features/cart/use-local-cart";
import type { MenuCatalog } from "@/features/menu/types";
import type { CreatedOrder } from "@/features/orders/types";
import { printOrder } from "@/features/printing/qz-client";

type MenuResponse = { data: MenuCatalog };
type CreateOrderResponse = { data: CreatedOrder };

export function PosScreen() {
  const cart = useLocalCart();
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const loadMenu = useCallback(async () => {
    try {
      const response = await fetch("/api/menu", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isMenuResponse(payload)) {
        throw new Error("Не удалось загрузить меню.");
      }
      setCatalog(payload.data);
      setErrorMessage(null);
    } catch {
      setErrorMessage("Не удалось загрузить меню. Проверьте подключение и обновите страницу.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadMenu(), 0);
    const refreshWhenReturning = () => void loadMenu();
    window.addEventListener("focus", refreshWhenReturning);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", refreshWhenReturning);
    };
  }, [loadMenu]);

  const visibleItems = useMemo(() => {
    if (!catalog) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
    return catalog.categories.flatMap((category) =>
      category.items.filter(
        (item) =>
          (selectedCategoryId === null || item.categoryId === selectedCategoryId) &&
          (!normalizedQuery || item.name.toLocaleLowerCase("ru-RU").includes(normalizedQuery)),
      ),
    );
  }, [catalog, query, selectedCategoryId]);

  const totalTyiyn = getCartTotalTyiyn(cart.items);

  async function submitOrder() {
    if (isSubmitting || cart.items.length === 0) return;

    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    setIsSubmitting(true);
    setCheckoutMessage(null);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          items: cart.items.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isCreateOrderResponse(payload)) {
        throw new Error(getApiErrorMessage(payload));
      }

      cart.clear();
      idempotencyKeyRef.current = null;
      setCheckoutMessage(`Заказ №${payload.data.orderNumber} успешно сохранён.`);
      void printOrder(payload.data, async (job, status, lastError) => {
        await fetch(`/api/print-jobs/${job.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, lastError: lastError ?? null }) });
        setCheckoutMessage(status === "failed" ? `Заказ №${payload.data.orderNumber} сохранён. Ошибка ${job.type === "customer" ? "клиентской" : "кухонной"} печати.` : `Заказ №${payload.data.orderNumber} сохранён. Чек передан на печать.`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить заказ.";
      setCheckoutMessage(`${message} Корзина сохранена — повторите попытку.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-labelledby="catalog-title" className="min-w-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 id="catalog-title" className="text-2xl font-bold tracking-tight">Касса</h1>
            <p className="mt-1 text-sm text-slate-600">Выберите блюда — они сразу появятся в корзине.</p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск блюда"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none placeholder:text-slate-400 focus:border-primary sm:w-64"
            aria-label="Поиск блюда"
          />
        </div>

        {catalog && (
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Категории">
            <CategoryButton active={selectedCategoryId === null} onClick={() => setSelectedCategoryId(null)}>
              Все
            </CategoryButton>
            {catalog.categories.map((category) => (
              <CategoryButton
                key={category.id}
                active={selectedCategoryId === category.id}
                onClick={() => setSelectedCategoryId(category.id)}
              >
                {category.name}
              </CategoryButton>
            ))}
          </div>
        )}

        {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{errorMessage}</p>}
        {!catalog && !errorMessage && <p className="rounded-xl bg-surface p-5 text-slate-600">Загрузка меню…</p>}
        {catalog && visibleItems.length === 0 && <p className="rounded-xl bg-surface p-5 text-slate-600">Ничего не найдено.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => cart.add(item)}
              disabled={isSubmitting}
              className="min-h-28 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-primary hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            >
              <span className="block text-base font-semibold">{item.name}</span>
              <span className="mt-3 block text-lg font-bold text-primary-strong">{formatSom(item.priceTyiyn)}</span>
            </button>
          ))}
        </div>
      </section>

      <aside aria-labelledby="cart-title" className="lg:sticky lg:top-5 lg:self-start">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cart-title" className="text-xl font-bold">Корзина</h2>
            <button
              type="button"
              onClick={cart.clear}
              disabled={cart.items.length === 0 || isSubmitting}
              className="text-sm font-medium text-slate-600 underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              Очистить
            </button>
          </div>
          {cart.items.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">Корзина пуста</p>
          ) : (
            <ul className="my-5 divide-y divide-border">
              {cart.items.map((item) => (
                <li key={item.menuItemId} className="py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{item.name}</p>
                    <p className="whitespace-nowrap font-semibold">{formatSom(item.priceTyiyn * item.quantity)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2" aria-label={`Количество: ${item.name}`}>
                      <QuantityButton disabled={isSubmitting} label={`Уменьшить ${item.name}`} onClick={() => cart.decrease(item.menuItemId)}>-</QuantityButton>
                      <span className="w-6 text-center font-semibold">{item.quantity}</span>
                      <QuantityButton disabled={isSubmitting} label={`Увеличить ${item.name}`} onClick={() => cart.increase(item.menuItemId)}>+</QuantityButton>
                    </div>
                    <button type="button" disabled={isSubmitting} onClick={() => cart.remove(item.menuItemId)} className="text-sm text-slate-500 underline disabled:cursor-wait disabled:opacity-40">Удалить</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-bold">Итого</span>
              <output className="text-2xl font-bold text-primary-strong">{formatSom(totalTyiyn)}</output>
            </div>
            <button type="button" onClick={submitOrder} disabled={cart.items.length === 0 || isSubmitting} className="mt-5 w-full rounded-xl bg-primary px-4 py-4 text-base font-bold text-white transition hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40">
              {isSubmitting ? "Сохранение…" : "Оформить заказ"}
            </button>
            {checkoutMessage && (
              <p role="status" className="mt-3 text-sm text-slate-700">{checkoutMessage}</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CategoryButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-primary text-white" : "bg-surface-muted text-slate-700 hover:bg-teal-100"}`}>{children}</button>;
}

function QuantityButton({ children, disabled, label, onClick }: { children: string; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid size-8 place-items-center rounded-lg bg-surface-muted text-lg font-bold hover:bg-teal-100 disabled:cursor-wait disabled:opacity-40">{children}</button>;
}

function isMenuResponse(payload: unknown): payload is MenuResponse {
  return Boolean(payload && typeof payload === "object" && "data" in payload);
}

function isCreateOrderResponse(payload: unknown): payload is CreateOrderResponse {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return false;
  const data = payload.data;
  return Boolean(data && typeof data === "object" && "orderNumber" in data && typeof data.orderNumber === "number");
}

function getApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "Не удалось сохранить заказ.";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") {
    return "Не удалось сохранить заказ.";
  }
  return error.message;
}
