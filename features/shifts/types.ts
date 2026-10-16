export type CashShift = {
  id: string;
  businessDate: string;
  openedBy: string;
  openedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  closeMode: "manual" | "overnight_auto";
  status: "open" | "closed";
  salesTotalTyiyn: number;
  soldItemCount: number;
};

export type ShiftDashboard = {
  currentShift: CashShift | null;
  shifts: CashShift[];
};
