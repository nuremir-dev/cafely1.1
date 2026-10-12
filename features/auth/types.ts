export const roles = ["cashier", "admin"] as const;

export type Role = (typeof roles)[number];

export type Session = {
  role: Role;
  cashierName: string;
};
