import type { Crawler } from "./interface";

export type CrawlerFactory = () => Crawler;

export class CrawlerRegistry {
  private factories = new Map<string, CrawlerFactory>();

  register(type: string, factory: CrawlerFactory): void {
    this.factories.set(type, factory);
  }

  get(type: string): CrawlerFactory | undefined {
    return this.factories.get(type);
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }
}
