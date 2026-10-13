export function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary-strong">Cafely MVP</p>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-slate-600">{description}</p>
    </section>
  );
}
