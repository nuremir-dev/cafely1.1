export type CashShift = {
  id: string;
  businessDate: string;
  openedBy: string;
  openedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  status: "open" | "closed";
  salesTotalTyiyn: number;
  soldItemCount: number;
};

export type ShiftDashboard = {
  currentShift: CashShift | null;
  shifts: CashShift[];
};
