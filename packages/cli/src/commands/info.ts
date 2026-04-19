import { Command } from "commander";
import { RemoteClient } from "./remote-client";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const infoCommand = new Command("info")
  .description("Show metadata about a published collection (name, title, entity count, size, crawler type, etc.)")
  .argument("<url>", "URL of the published site (e.g. https://my-fink.workers.dev)")
  .option("--password <password>", "Password for protected sites")
  .option("--json", "Output raw JSON instead of formatted text")
  .addHelpText("after", `
Examples:
  fink info https://my-fink.workers.dev --password secret123
  fink info https://my-fink.workers.dev --json
`)
  .action(async (url: string, opts: { password?: string; json?: boolean }) => {
    const client = new RemoteClient(url, opts.password);
    const info = await client.getInfo();

    if (opts.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    console.log(`Collection: ${info.title} (${info.name})`);
    if (info.description) console.log(`Description: ${info.description}`);
    console.log(`Crawler:    ${info.crawlerType}`);
    console.log(`Entities:   ${info.entityCount}`);
    const typeEntries = Object.entries(info.entityTypes);
    if (typeEntries.length > 0) {
      const byType = typeEntries
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}=${n}`)
        .join(", ");
      console.log(`  by type:  ${byType}`);
    }
    console.log(`Size:       ${formatBytes(info.totalDataBytes)} (entity data)`);
    if (info.lastUpdatedAt) console.log(`Updated:    ${info.lastUpdatedAt}`);
    console.log(`Manifest:   v${info.manifestVersion} (hash ${info.manifestHash.slice(0, 12)})`);
    console.log(`Worker:     build ${info.workerBuildId}`);
    console.log(`Generated:  ${info.generatedAt}`);
  });
