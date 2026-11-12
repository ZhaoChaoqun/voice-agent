/** Bounded local retrieval: manufacturer facts, clearly fictional demo data, and uploads. */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { KnowledgeSource } from "@shared/protocol";
import { InputError } from "#server/home";

const MAX_UPLOADS = 40; // Keep one local demo's retrieval and disk usage bounded.
const EXCERPT_LENGTH = 1800; // Bound each retrieved document sent back to the model.
const MAX_RESULTS = 3; // Keep tool outputs small enough for a spoken answer.
export const uploadSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(40_000),
  })
  .strict();
const documentSchema = uploadSchema
  .extend({
    id: z.string().min(1).max(100),
    kind: z.enum(["manufacturer", "demo", "uploaded"]),
    url: z.string().url().optional(),
  })
  .strict();
type Document = z.infer<typeof documentSchema>;

/** A source paired with a bounded excerpt, never treated as executable instructions. */
export interface SearchResult {
  source: KnowledgeSource;
  excerpt: string;
}

function sourceOf(document: Document): KnowledgeSource {
  const { content: _content, ...source } = document;
  return source;
}

function queryTokens(query: string): string[] {
  const normalized = query.toLowerCase();
  const words: string[] = normalized.match(/[a-z0-9][a-z0-9_/-]+/g) ?? [];
  const chinese = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const phrase of chinese) {
    for (let index = 0; index < phrase.length - 1; index += 1)
      words.push(phrase.slice(index, index + 2));
  }
  return [...new Set(words)];
}

/** Persist uploaded plain text under generated filenames; never fetch supplied URLs. */
export class KnowledgeStore {
  private documents: Document[];
  private readonly uploadPath: string;

  constructor(
    root: string = fileURLToPath(new URL("../knowledge/", import.meta.url)),
    options: { uploadPath?: string } = {},
  ) {
    this.documents = z
      .array(documentSchema)
      .parse(JSON.parse(readFileSync(join(root, "products.json"), "utf8")));
    this.uploadPath = options.uploadPath ?? join(root, "uploads");
    mkdirSync(this.uploadPath, { recursive: true });
    this.loadUploads();
  }

  /** List safe citation metadata without exposing entire uploaded documents. */
  sources(): KnowledgeSource[] {
    return this.documents.map(sourceOf);
  }

  /** Store a bounded text/Markdown document; extraction of PDF/HTML is intentionally unsupported. */
  upload(input: unknown): KnowledgeSource {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success)
      throw new InputError(
        "Provide a title, model and plain text or Markdown content (maximum 40,000 characters).",
      );
    if (
      this.documents.filter((entry) => entry.kind === "uploaded").length >=
      MAX_UPLOADS
    ) {
      throw new InputError(
        "This local demo has reached its 40-document upload limit.",
      );
    }
    const document: Document = {
      ...parsed.data,
      id: randomUUID(),
      kind: "uploaded",
    };
    writeFileSync(
      join(this.uploadPath, `${document.id}.json`),
      JSON.stringify(document),
      { flag: "wx", mode: 0o600 },
    );
    this.documents.push(document);
    console.info("Knowledge document added", { id: document.id });
    return sourceOf(document);
  }

  /** Retrieve relevant source excerpts; no match is preferable to invented product specifications. */
  search(query: string): SearchResult[] {
    const tokens = queryTokens(query);
    const ranked = this.documents.map((document) => {
      const text =
        `${document.title} ${document.model} ${document.content}`.toLowerCase();
      const score = tokens.reduce(
        (sum, token) => sum + (text.includes(token) ? 1 : 0),
        0,
      );
      return { document, score };
    });
    return ranked
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RESULTS)
      .map(({ document }) => ({
        source: sourceOf(document),
        excerpt: document.content.slice(0, EXCERPT_LENGTH),
      }));
  }

  private loadUploads(): void {
    for (const filename of readdirSync(this.uploadPath)
      .filter((entry) => /^[a-f0-9-]+\.json$/.test(entry))
      .slice(0, MAX_UPLOADS)) {
      try {
        const document = documentSchema.parse(
          JSON.parse(readFileSync(join(this.uploadPath, filename), "utf8")),
        );
        if (document.kind === "uploaded") this.documents.push(document);
      } catch {
        console.warn("Skipped an invalid local knowledge upload.");
      }
    }
  }
}
