import type { OrderItemSnapshot, PrintJob } from "@/features/orders/types";

export type HistoryOrder = {
  id: string;
  orderNumber: number;
  totalTyiyn: number;
  cashierName: string;
  createdAt: string;
  itemCount: number;
};

export type HistoryPage = {
  orders: HistoryOrder[];
  nextCursor: string | null;
};

export type OrderDetails = {
  id: string;
  orderNumber: number;
  totalTyiyn: number;
  cashierName: string;
  createdAt: string;
  items: OrderItemSnapshot[];
  printJobs: PrintJob[];
};
