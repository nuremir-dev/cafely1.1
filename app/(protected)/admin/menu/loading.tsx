export default function LoadingMenuPage() {
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm font-semibold text-slate-600 shadow-sm">
        <span className="size-8 animate-spin rounded-full border-4 border-teal-100 border-t-primary" aria-hidden="true" />
        Загружаем меню…
      </div>
    </div>
  );
}
