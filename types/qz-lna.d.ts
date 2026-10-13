declare module "qz-lna" {
  export class LnaError extends Error {
    denied?: boolean;
  }

  export function detectLna(...args: unknown[]): Promise<unknown>;
}
