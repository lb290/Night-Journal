#!/usr/bin/env node
/**
 * Backfill compression for images uploaded before it existed.
 *
 * Earlier uploads were stored at full resolution with no thumbnail. This script
 * walks `entry_attachments`, re-encodes anything that is still larger than the
 * current limits, writes the thumbnail, and updates the row.
 *
 *   node scripts/nj-compress-backfill.mjs           # dry run, prints a report
 *   node scripts/nj-compress-backfill.mjs --apply   # actually rewrite files
 *
 * Safe to re-run: rows already pointing at a compressed JPEG with a thumbnail
 * are skipped.
 */
import fs from "fs";
import path from "path";
import process from "process";

const REPO_DIR = path.resolve(import.meta.dirname, "..");
const APPLY = process.argv.includes("--apply");

// Load .env without pulling in a dependency
const envPath = path.join(REPO_DIR, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

const UPLOAD_DIR = path.resolve(
  REPO_DIR,
  process.env.UPLOAD_DIR || "data/uploads",
);
const THUMB_DIR_NAME = "thumb";

const { default: mysql } = await import("mysql2/promise");
// Node 22 strips TypeScript types natively, so the shared image pipeline can be
// imported straight from source — no build step needed before a backfill.
const { processImage } = await import(
  path.join(REPO_DIR, "api/lib/image.ts")
);

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, user_id, storage_path, thumb_storage_path, file_type
     FROM entry_attachments
    ORDER BY id`,
);

let totalBefore = 0;
let totalAfter = 0;
let compressed = 0;
let skipped = 0;
const failures = [];

for (const row of rows) {
  const storagePath = row.storage_path;
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`#${row.id} missing on disk: ${storagePath}`);
    continue;
  }

  const before = fs.statSync(fullPath).size;
  totalBefore += before;

  const alreadyDone = !!row.thumb_storage_path;
  if (alreadyDone) {
    skipped++;
    totalAfter += before;
    console.log(`  skip  #${row.id}  ${storagePath}  (already has thumbnail)`);
    continue;
  }

  const buffer = fs.readFileSync(fullPath);
  const processed = await processImage(
    buffer,
    path.basename(storagePath),
    row.file_type,
  );

  if (!processed) {
    skipped++;
    totalAfter += before;
    failures.push(`#${row.id} could not be decoded: ${storagePath}`);
    continue;
  }

  const fileName = path.basename(storagePath, path.extname(storagePath)) + ".jpg";
  const newStoragePath = `${row.user_id}/${fileName}`;
  const newFullPath = path.join(UPLOAD_DIR, newStoragePath);
  const thumbStoragePath = `${row.user_id}/${THUMB_DIR_NAME}/${fileName}`;
  const thumbFullPath = path.join(UPLOAD_DIR, thumbStoragePath);

  totalAfter += processed.main.length;
  compressed++;
  console.log(
    `  pack  #${row.id}  ${storagePath}  ` +
      `${(before / 1024).toFixed(0)}KB → ${(processed.main.length / 1024).toFixed(0)}KB ` +
      `(+${(processed.thumbnail.length / 1024).toFixed(0)}KB thumb)`,
  );

  if (!APPLY) continue;

  fs.mkdirSync(path.dirname(thumbFullPath), { recursive: true });
  fs.writeFileSync(newFullPath, processed.main);
  fs.writeFileSync(thumbFullPath, processed.thumbnail);

  // The re-encode changes the extension, so the old file must go
  if (path.resolve(fullPath) !== path.resolve(newFullPath)) {
    fs.unlinkSync(fullPath);
  }

  await conn.execute(
    `UPDATE entry_attachments
        SET storage_path = ?, file_url = ?, thumb_storage_path = ?,
            file_type = 'image/jpeg', file_size = ?
      WHERE id = ?`,
    [
      newStoragePath,
      `/api/uploads/${newStoragePath}`,
      thumbStoragePath,
      processed.main.length,
      row.id,
    ],
  );
}

await conn.end();

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
console.log("\n── 汇总 ──");
console.log(`  附件总数     ${rows.length}`);
console.log(`  已压缩       ${compressed}`);
console.log(`  跳过         ${skipped}`);
console.log(`  压缩前       ${mb(totalBefore)}`);
console.log(`  压缩后       ${mb(totalAfter)}`);
if (totalBefore > 0) {
  console.log(
    `  节省         ${mb(totalBefore - totalAfter)} ` +
      `(${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}%)`,
  );
}
if (failures.length) {
  console.log(`\n  问题 ${failures.length} 条：`);
  for (const f of failures) console.log(`    - ${f}`);
}
if (!APPLY) {
  console.log("\n  这是预演（dry run）。确认无误后加 --apply 真正执行。");
}
