import fs from "node:fs";
import path from "node:path";
import { wikiDir } from "./db.js";
import { listMemoryEntries, memoryCategories, type MemoryCategory, type MemoryEntryRow } from "./memoryEntries.js";

const categoryFiles: Record<MemoryCategory, { title: string; file: string }> = {
  business: { title: "Business Context", file: "context/business.md" },
  materials: { title: "Materials Policy", file: "policies/materials.md" },
  printers: { title: "Printers Policy", file: "policies/printers.md" },
  website: { title: "Website Policy", file: "policies/website.md" },
  marketplace: { title: "Marketplace Policy", file: "policies/marketplace.md" },
  open_loops: { title: "Open Loops", file: "context/open_loops.md" },
  operating_model: { title: "Operating Model", file: "operating_model.md" },
  runbooks: { title: "Runbooks", file: "runbooks/index.md" }
};

export function wikiPathForCategory(category: MemoryCategory): string {
  return path.join(wikiDir(), categoryFiles[category].file);
}

export function rebuildWiki(): string[] {
  const written: string[] = [];
  const root = wikiDir();
  fs.mkdirSync(root, { recursive: true });

  for (const category of memoryCategories) {
    const entries = listMemoryEntries(category);
    const outputPath = wikiPathForCategory(category);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, renderCategory(category, entries), "utf8");
    written.push(outputPath);
  }

  const indexPath = path.join(root, "index.md");
  fs.writeFileSync(indexPath, renderIndex(), "utf8");
  written.push(indexPath);
  return written;
}

function renderIndex(): string {
  const links = memoryCategories
    .map((category) => `- [${categoryFiles[category].title}](${categoryFiles[category].file})`)
    .join("\n");

  return `# MICBot Wiki\n\n${links}\n\n---\n\nGenerated from SQLite memory_entries. Raw messages remain the source of truth.\n`;
}

function renderCategory(category: MemoryCategory, entries: MemoryEntryRow[]): string {
  const header = `# ${categoryFiles[category].title}`;
  const body = entries.length
    ? entries.map(renderEntry).join("\n\n")
    : "_No memory entries yet._";

  return `${header}\n\n${body}\n\n---\n\nGenerated from SQLite memory_entries. Raw messages remain the source of truth.\n`;
}

function renderEntry(entry: MemoryEntryRow): string {
  const sourceIds = JSON.parse(entry.source_raw_message_ids) as number[];
  const sourceText = sourceIds.length ? sourceIds.join(", ") : "none";
  return `## ${entry.title}\n\nStatus: ${entry.status}\nSource raw messages: ${sourceText}\n\n${entry.body}`;
}
