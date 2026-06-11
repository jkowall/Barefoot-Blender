#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.argv[2] ?? "ios/App/App/public";
const forbiddenTerms = ["Android", "Google", "Google Play", "Play Store"];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt", ".webmanifest", ".xml"]);
const binaryExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".png", ".webp", ".woff", ".woff2"]);

const extensionOf = (filePath) => {
  const index = filePath.lastIndexOf(".");
  return index === -1 ? "" : filePath.slice(index).toLowerCase();
};

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extensionOf(entry.name);
    if (binaryExtensions.has(extension)) {
      continue;
    }

    if (textExtensions.has(extension) || extension === "") {
      files.push(fullPath);
    }
  }

  return files;
};

const rootStats = await stat(root).catch(() => undefined);
if (!rootStats?.isDirectory()) {
  console.error(`iOS public asset directory not found: ${root}`);
  process.exit(1);
}

const files = await walk(root);
const violations = [];

for (const filePath of files) {
  const content = await readFile(filePath, "utf8");
  for (const term of forbiddenTerms) {
    if (content.includes(term)) {
      violations.push(`${relative(root, filePath)} contains "${term}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("iOS App Store copy check failed. Remove third-party platform references from iOS-visible assets:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`iOS App Store copy check passed for ${files.length} text assets.`);
