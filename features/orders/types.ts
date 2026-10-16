export type OrderItemSnapshot = {
  menuItemId: string | null;
  serviceLocation?: "hall" | "takeaway";
  itemName: string;
  kitchenComment?: string | null;
  unitPriceTyiyn: number;
  quantity: number;
  lineTotalTyiyn: number;
};

export type PrintJob = {
  id: string;
  type: "customer" | "kitchen";
  status: "pending" | "processing" | "submitted" | "failed";
  attempts: number;
  lastError: string | null;
};

export type CreatedOrder = {
  id: string;
  orderNumber: number;
  tableNumber?: number | null;
  serviceLocation?: "hall" | "takeaway";
  totalTyiyn: number;
  cashierName: string;
  createdAt: string;
  items: OrderItemSnapshot[];
  printJobs: PrintJob[];
  created: boolean;
};

export type CreateOrderInput = {
  idempotencyKey: string;
  items: Array<{ menuItemId: string; quantity: number }>;
};
