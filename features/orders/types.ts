export type OrderItemSnapshot = {
  menuItemId: string;
  itemName: string;
  unitPriceTyiyn: number;
  quantity: number;
  lineTotalTyiyn: number;
};

export type PrintJob = {
  id: string;
  type: "customer" | "kitchen";
  status: "pending" | "submitted" | "failed";
  attempts: number;
  lastError: string | null;
};

export type CreatedOrder = {
  id: string;
  orderNumber: number;
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
