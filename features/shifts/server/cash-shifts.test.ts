import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import { autoCloseStaleCashShift } from "./cash-shifts";

const row = {
  id: "9e445dde-5a82-4f3f-a4c5-7472f3fdb5e6",
  business_date: "2026-10-15",
  opened_by: "Айжан",
  opened_at: "2026-10-15T03:00:00.000Z",
  closed_by: "Система (автозакрытие)",
  closed_at: "2026-10-15T18:00:00.000Z",
  close_mode: "overnight_auto" as const,
  status: "closed" as const,
  sales_total_tyiyn: 15_000,
  sold_item_count: 2,
};

describe("autoCloseStaleCashShift", () => {
  beforeEach(() => mocks.createSupabaseAdminClient.mockReset());

  it("returns the automatically closed stale shift", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...row, outcome: "closed" }], error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });

    await expect(autoCloseStaleCashShift()).resolves.toMatchObject({
      outcome: "closed",
      shift: { businessDate: "2026-10-15", openedBy: "Айжан", closeMode: "overnight_auto", status: "closed" },
    });
    expect(rpc).toHaveBeenCalledWith("auto_close_stale_cafeline_cash_shift");
  });

  it("returns no result when there is no stale shift", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) });

    await expect(autoCloseStaleCashShift()).resolves.toEqual({ outcome: "none", shift: null });
  });
});
