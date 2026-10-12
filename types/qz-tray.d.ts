declare module "qz-tray" {
  type Qz = {
    websocket: { isActive(): boolean; connect(): Promise<void> };
    printers: { find(): Promise<string[]> };
    configs: { create(printer: string, options: object): unknown };
    print(config: unknown, data: unknown[]): Promise<void>;
    security: {
      setSignatureAlgorithm(algorithm: string): void;
      setCertificatePromise(factory: (resolve: (value: string) => void, reject: (reason: unknown) => void) => void): void;
      setSignaturePromise(factory: (request: string) => (resolve: (value: string) => void, reject: (reason: unknown) => void) => void): void;
    };
  };
  const qz: Qz;
  export default qz;
}
