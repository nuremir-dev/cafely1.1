"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { AdminCategory, AdminMenuData, AdminMenuItem } from "@/features/admin-menu/types";
import { formatSom } from "@/features/cart/cart";
import { parseSomToTyiyn } from "@/features/money/parse-som";
import { getPrinterSettings, getQzPrinters, savePrinterSettings } from "@/features/printing/qz-client";

export function MenuAdminScreen({ initialData }: { initialData: AdminMenuData }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submitCategory(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    await submit(`/api/admin/categories${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
      name: String(new FormData(form).get("name") ?? ""),
      sortOrder: Number(new FormData(form).get("sortOrder")),
      isActive: new FormData(form).has("isActive"),
      fulfillmentType: String(new FormData(form).get("fulfillmentType") ?? "kitchen"),
    });
    if (!id) form.reset();
  }

  async function submitItem(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const priceTyiyn = parseSomToTyiyn(String(formData.get("priceSom") ?? ""));
    if (priceTyiyn === null) {
      setMessage("Укажите корректную неотрицательную цену: например, 250 или 40,50.");
      return;
    }

    await submit(`/api/admin/menu-items${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
      name: String(formData.get("name") ?? ""),
      categoryId: String(formData.get("categoryId") ?? ""),
      priceTyiyn,
      sortOrder: Number(formData.get("sortOrder")),
      isActive: formData.has("isActive"),
    });
    if (!id) form.reset();
  }

  async function submit(url: string, method: "POST" | "PATCH", body: object) {
    if (isSaving) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readErrorMessage(payload));
      setMessage("Изменения сохранены. Каталог кассы обновится при возврате к нему.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-9">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Управление меню</h1>
        <p className="mt-1 text-sm text-slate-600">Порядок задаётся числом: меньшее значение показывается раньше.</p>
      </header>
      {message && <p role="status" className="rounded-xl bg-surface-muted p-4 text-sm text-slate-700">{message}</p>}
      <PrinterSettingsPanel />

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="categories-title">
        <h2 id="categories-title" className="text-lg font-bold">Категории</h2>
        <form onSubmit={(event) => void submitCategory(event)} className="mt-4 grid gap-3 md:grid-cols-[1fr_10rem_8rem_auto_auto]">
          <TextField name="name" label="Новая категория" required />
          <FulfillmentField />
          <NumberField name="sortOrder" label="Порядок" defaultValue="0" />
          <label className="flex items-end gap-2 pb-3 text-sm"><input name="isActive" type="checkbox" defaultChecked /> Активна</label>
          <button disabled={isSaving} className="self-end rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">Добавить</button>
        </form>
        <div className="mt-5 space-y-3">
          {initialData.categories.map((category) => (
            <CategoryForm key={category.id} category={category} isSaving={isSaving} onSubmit={submitCategory} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="items-title">
        <h2 id="items-title" className="text-lg font-bold">Блюда</h2>
        {initialData.categories.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">Сначала создайте хотя бы одну категорию.</p>
        ) : (
          <form onSubmit={(event) => void submitItem(event)} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_12rem_9rem_7rem_auto]">
            <TextField name="name" label="Новое блюдо" required />
            <label className="grid gap-1 text-sm font-medium">Категория<select name="categoryId" required className="rounded-lg border border-border bg-white px-3 py-2.5">{initialData.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <TextField name="priceSom" label="Цена, сом" placeholder="250" required inputMode="decimal" />
            <NumberField name="sortOrder" label="Порядок" defaultValue="0" />
            <div className="flex items-end gap-3"><label className="flex gap-2 pb-3 text-sm"><input name="isActive" type="checkbox" defaultChecked /> Активно</label><button disabled={isSaving} className="mb-0 rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">Добавить</button></div>
          </form>
        )}
        <div className="mt-5 space-y-3">
          {initialData.items.map((item) => (
            <MenuItemForm key={item.id} item={item} categories={initialData.categories} isSaving={isSaving} onSubmit={submitItem} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PrinterSettingsPanel() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [settings, setSettings] = useState({ customerPrinter: "", kitchenPrinter: "" });
  const [status, setStatus] = useState("QZ Tray ещё не проверен.");
  async function discover() { try { const found = await getQzPrinters(); const saved = getPrinterSettings(); setPrinters(found); setSettings(saved); setStatus(`QZ Tray подключён: найдено принтеров — ${found.length}.`); } catch (error) { setStatus(error instanceof Error ? `QZ Tray недоступен: ${error.message}` : "QZ Tray недоступен."); } }
  function update(key: "customerPrinter" | "kitchenPrinter", value: string) { const next = { ...settings, [key]: value }; setSettings(next); savePrinterSettings(next); }
  return <section className="rounded-2xl border border-border bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Принтеры</h2><p className="mt-1 text-sm text-slate-600">{status}</p></div><button type="button" onClick={() => void discover()} className="rounded-xl border border-border px-4 py-3 font-semibold">Проверить QZ Tray</button></div>{printers.length > 0 && <div className="mt-4 grid gap-3 md:grid-cols-2"><PrinterSelect label="Клиентский принтер" value={settings.customerPrinter} printers={printers} onChange={(value) => update("customerPrinter", value)} /><PrinterSelect label="Кухонный принтер" value={settings.kitchenPrinter} printers={printers} onChange={(value) => update("kitchenPrinter", value)} /></div>}</section>;
}

function PrinterSelect({ label, onChange, printers, value }: { label: string; onChange: (value: string) => void; printers: string[]; value: string }) { return <label className="grid gap-1 text-sm font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-border bg-white px-3 py-2.5"><option value="">Не выбран</option>{printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}</select></label>; }

function CategoryForm({ category, isSaving, onSubmit }: { category: AdminCategory; isSaving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>, id: string) => Promise<void> }) {
  return <form onSubmit={(event) => void onSubmit(event, category.id)} className="grid gap-3 rounded-xl bg-surface-muted p-3 md:grid-cols-[1fr_10rem_8rem_auto_auto]"><TextField name="name" label="Название" defaultValue={category.name} required /><FulfillmentField defaultValue={category.fulfillmentType} /><NumberField name="sortOrder" label="Порядок" defaultValue={String(category.sortOrder)} /><label className="flex items-end gap-2 pb-3 text-sm"><input name="isActive" type="checkbox" defaultChecked={category.isActive} /> Активна</label><button disabled={isSaving} className="self-end rounded-xl border border-border px-4 py-3 font-semibold disabled:opacity-50">Сохранить</button></form>;
}

function FulfillmentField({ defaultValue = "kitchen" }: { defaultValue?: "kitchen" | "counter" | "beverage" }) {
  return <label className="grid gap-1 text-sm font-medium">Готовится<select name="fulfillmentType" defaultValue={defaultValue} className="rounded-lg border border-border bg-white px-3 py-2.5"><option value="kitchen">На кухне</option><option value="counter">Витрина</option><option value="beverage">Напитки</option></select></label>;
}

function MenuItemForm({ item, categories, isSaving, onSubmit }: { item: AdminMenuItem; categories: AdminCategory[]; isSaving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>, id: string) => Promise<void> }) {
  return <form onSubmit={(event) => void onSubmit(event, item.id)} className="grid gap-3 rounded-xl bg-surface-muted p-3 md:grid-cols-2 xl:grid-cols-[1fr_12rem_9rem_7rem_auto]"><TextField name="name" label="Название" defaultValue={item.name} required /><label className="grid gap-1 text-sm font-medium">Категория<select name="categoryId" defaultValue={item.categoryId} className="rounded-lg border border-border bg-white px-3 py-2.5">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><TextField name="priceSom" label="Цена, сом" defaultValue={formatSom(item.priceTyiyn).replace(" сом", "")} required inputMode="decimal" /><NumberField name="sortOrder" label="Порядок" defaultValue={String(item.sortOrder)} /><div className="flex items-end gap-3"><label className="flex gap-2 pb-3 text-sm"><input name="isActive" type="checkbox" defaultChecked={item.isActive} /> Активно</label><button disabled={isSaving} className="rounded-xl border border-border px-4 py-3 font-semibold disabled:opacity-50">Сохранить</button></div></form>;
}

function TextField({ defaultValue, inputMode, label, name, placeholder, required }: { defaultValue?: string; inputMode?: "decimal"; label: string; name: string; placeholder?: string; required?: boolean }) {
  return <label className="grid gap-1 text-sm font-medium">{label}<input name={name} defaultValue={defaultValue} inputMode={inputMode} placeholder={placeholder} required={required} className="rounded-lg border border-border bg-white px-3 py-2.5" /></label>;
}

function NumberField({ defaultValue, label, name }: { defaultValue: string; label: string; name: string }) {
  return <label className="grid gap-1 text-sm font-medium">{label}<input name={name} type="number" min="0" step="1" defaultValue={defaultValue} required className="rounded-lg border border-border bg-white px-3 py-2.5" /></label>;
}

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "Не удалось сохранить изменения.";
  const error = payload.error;
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Не удалось сохранить изменения.";
}
