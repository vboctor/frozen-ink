import type { Connector } from "./interface";

export type ConnectorFactory = () => Connector;

export class ConnectorRegistry {
  private factories = new Map<string, ConnectorFactory>();

  register(type: string, factory: ConnectorFactory): void {
    this.factories.set(type, factory);
  }

  get(type: string): ConnectorFactory | undefined {
    return this.factories.get(type);
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }
}
