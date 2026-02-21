#!/usr/bin/env npx tsx
/**
 * Devlog Cleanup Script
 *
 * Organizes and cleans up devlog directory structure with:
 * - Dry-run mode (preview changes without modifying)
 * - Backup before changes
 * - Rollback capability
 * - Duplicate detection
 * - File organization
 *
 * Usage:
 *   npx tsx scripts/cleanup.ts --devlog /path/to/devlog --dry-run
 *   npx tsx scripts/cleanup.ts --devlog /path/to/devlog --backup
 *   npx tsx scripts/cleanup.ts --devlog /path/to/devlog --execute
 *   npx tsx scripts/cleanup.ts --devlog /path/to/devlog --rollback
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { glob } from "glob";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface FileInfo {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  hash: string;
  mtime: Date;
  folder: string;
  hasYamlFrontmatter: boolean;
  tags: string[];
  status?: string;
}

interface DuplicateGroup {
  hash: string;
  files: FileInfo[];
  keep: FileInfo;
  remove: FileInfo[];
}

interface CleanupPlan {
  moveOperations: { from: string; to: string; reason: string }[];
  deleteOperations: { path: string; reason: string }[];
  archiveOperations: { from: string; to: string; reason: string }[];
  duplicates: DuplicateGroup[];
  emptyFolders: string[];
  summary: {
    totalFiles: number;
    rootFiles: number;
    duplicates: number;
    toArchive: number;
    emptyFolders: number;
  };
}

interface CleanupOptions {
  devlogPath: string;
  dryRun: boolean;
  backup: boolean;
  execute: boolean;
  rollback: boolean;
  archiveAfterDays: number;
  verbose: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const TARGET_FOLDERS = {
  inbox: "inbox",
  active: "active",
  backlog: "backlog",
  archive: "archive",
  research: "research",
  decisions: "decisions",
  prd: "prd",
};

const IGNORED_FOLDERS = [".mcp", ".obsidian", ".private", ".tags", ".git", "node_modules", ".devlog"];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

function extractFrontmatter(content: string): { tags: string[]; status?: string } {
  const tags: string[] = [];
  let status: string | undefined;

  // Check for YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];

    // Extract tags
    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);
    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, "")));
    }

    // Extract status
    const statusMatch = yaml.match(/status:\s*(\w+)/);
    if (statusMatch) {
      status = statusMatch[1];
    }
  }

  // Extract inline hashtags
  const hashtagMatches = content.match(/#[\w-]+/g);
  if (hashtagMatches) {
    tags.push(...hashtagMatches.map((t) => t.substring(1)));
  }

  return { tags: [...new Set(tags)], status };
}

function getFileAge(mtime: Date): number {
  return Math.floor((Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getArchivePath(mtime: Date): string {
  const year = mtime.getFullYear();
  const month = String(mtime.getMonth() + 1).padStart(2, "0");
  return path.join("archive", String(year), month);
}

function inferTargetFolder(file: FileInfo): string {
  const name = file.name.toLowerCase();
  const tags = file.tags.map((t) => t.toLowerCase());

  // Check status from frontmatter
  if (file.status) {
    if (file.status === "done" || file.status === "completed") return TARGET_FOLDERS.archive;
    if (file.status === "active" || file.status === "in-progress") return TARGET_FOLDERS.active;
    if (file.status === "backlog") return TARGET_FOLDERS.backlog;
  }

  // Check by tags
  if (tags.includes("research") || tags.includes("analysis")) return TARGET_FOLDERS.research;
  if (tags.includes("decision") || tags.includes("adr")) return TARGET_FOLDERS.decisions;
  if (tags.includes("prd") || tags.includes("spec")) return TARGET_FOLDERS.prd;

  // Check by filename patterns
  if (name.includes("research") || name.includes("analysis") || name.includes("investigation")) {
    return TARGET_FOLDERS.research;
  }
  if (name.includes("decision") || name.includes("adr")) {
    return TARGET_FOLDERS.decisions;
  }
  if (name.includes("prd") || name.includes("spec") || name.includes("requirement")) {
    return TARGET_FOLDERS.prd;
  }
  if (name.includes("plan") || name.includes("sprint")) {
    return TARGET_FOLDERS.active;
  }

  // Default to inbox for unclassified files
  return TARGET_FOLDERS.inbox;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════════════════════

async function scanDevlog(devlogPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const pattern = path.join(devlogPath, "**/*.md");

  const matches = await glob(pattern, {
    ignore: IGNORED_FOLDERS.map((f) => `**/${f}/**`),
  });

  for (const filePath of matches) {
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(devlogPath, filePath);
    const folder = path.dirname(relativePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const { tags, status } = extractFrontmatter(content);

    files.push({
      path: filePath,
      relativePath,
      name: path.basename(filePath, ".md"),
      size: stat.size,
      hash: hashFile(filePath),
      mtime: stat.mtime,
      folder: folder === "." ? "" : folder,
      hasYamlFrontmatter: content.startsWith("---"),
      tags,
      status,
    });
  }

  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

function findDuplicates(files: FileInfo[]): DuplicateGroup[] {
  const hashMap = new Map<string, FileInfo[]>();

  for (const file of files) {
    const existing = hashMap.get(file.hash) || [];
    existing.push(file);
    hashMap.set(file.hash, existing);
  }

  const duplicates: DuplicateGroup[] = [];

  for (const [hash, group] of hashMap) {
    if (group.length > 1) {
      // Keep the newest file with the most content
      const sorted = group.sort((a, b) => {
        // Prefer files with YAML frontmatter
        if (a.hasYamlFrontmatter && !b.hasYamlFrontmatter) return -1;
        if (!a.hasYamlFrontmatter && b.hasYamlFrontmatter) return 1;
        // Then prefer newer files
        return b.mtime.getTime() - a.mtime.getTime();
      });

      duplicates.push({
        hash,
        files: group,
        keep: sorted[0],
        remove: sorted.slice(1),
      });
    }
  }

  return duplicates;
}

function findEmptyFolders(devlogPath: string): string[] {
  const emptyFolders: string[] = [];

  function checkFolder(folderPath: string): boolean {
    if (!fs.existsSync(folderPath)) return true;

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const nonIgnored = entries.filter(
      (e) => !e.name.startsWith(".") && !IGNORED_FOLDERS.includes(e.name)
    );

    if (nonIgnored.length === 0) {
      emptyFolders.push(path.relative(devlogPath, folderPath));
      return true;
    }

    // Check subdirectories
    for (const entry of nonIgnored) {
      if (entry.isDirectory()) {
        checkFolder(path.join(folderPath, entry.name));
      }
    }

    return false;
  }

  checkFolder(devlogPath);
  return emptyFolders.filter((f) => f !== "");
}

function createCleanupPlan(
  files: FileInfo[],
  devlogPath: string,
  archiveAfterDays: number
): CleanupPlan {
  const plan: CleanupPlan = {
    moveOperations: [],
    deleteOperations: [],
    archiveOperations: [],
    duplicates: findDuplicates(files),
    emptyFolders: findEmptyFolders(devlogPath),
    summary: {
      totalFiles: files.length,
      rootFiles: 0,
      duplicates: 0,
      toArchive: 0,
      emptyFolders: 0,
    },
  };

  // Find root files (not in any subfolder)
  const rootFiles = files.filter((f) => f.folder === "");
  plan.summary.rootFiles = rootFiles.length;

  for (const file of rootFiles) {
    const targetFolder = inferTargetFolder(file);
    const targetPath = path.join(targetFolder, path.basename(file.path));

    plan.moveOperations.push({
      from: file.relativePath,
      to: targetPath,
      reason: `Move to ${targetFolder} (inferred from content/name)`,
    });
  }

  // Find old files to archive
  for (const file of files) {
    const age = getFileAge(file.mtime);

    if (
      age > archiveAfterDays &&
      !file.folder.startsWith("archive") &&
      file.status !== "active" &&
      file.status !== "in-progress"
    ) {
      const archivePath = path.join(getArchivePath(file.mtime), path.basename(file.path));

      plan.archiveOperations.push({
        from: file.relativePath,
        to: archivePath,
        reason: `Archive (${age} days old, last modified ${formatDate(file.mtime)})`,
      });
      plan.summary.toArchive++;
    }
  }

  // Count duplicates to remove
  plan.summary.duplicates = plan.duplicates.reduce((sum, g) => sum + g.remove.length, 0);
  plan.summary.emptyFolders = plan.emptyFolders.length;

  // Add duplicate deletions to plan
  for (const group of plan.duplicates) {
    for (const file of group.remove) {
      plan.deleteOperations.push({
        path: file.relativePath,
        reason: `Duplicate of ${group.keep.relativePath} (keeping newer/better version)`,
      });
    }
  }

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP & RESTORE
// ═══════════════════════════════════════════════════════════════════════════

async function createBackup(devlogPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
  const backupDir = path.join(devlogPath, ".devlog-backup", `${timestamp}-pre-cleanup`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Create manifest of all files
  const manifest: { files: { path: string; hash: string }[]; timestamp: string } = {
    files: [],
    timestamp: new Date().toISOString(),
  };

  // Copy all markdown files to backup using glob
  const mdFiles = await glob(path.join(devlogPath, "**/*.md"), {
    ignore: [
      ...IGNORED_FOLDERS.map((f) => `**/${f}/**`),
      "**/node_modules/**",
      "**/.devlog-backup/**",
    ],
  });

  for (const filePath of mdFiles) {
    const relativePath = path.relative(devlogPath, filePath);

    // Skip backup folder itself
    if (relativePath.startsWith(".devlog-backup")) continue;

    const targetPath = path.join(backupDir, relativePath);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(filePath, targetPath);
    manifest.files.push({
      path: relativePath,
      hash: hashFile(filePath),
    });
  }

  // Save manifest
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return backupDir;
}

function findLatestBackup(devlogPath: string): string | null {
  const backupRoot = path.join(devlogPath, ".devlog-backup");

  if (!fs.existsSync(backupRoot)) return null;

  const backups = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  return backups.length > 0 ? path.join(backupRoot, backups[0]) : null;
}

function rollback(devlogPath: string): void {
  const backupDir = findLatestBackup(devlogPath);

  if (!backupDir) {
    console.error("No backup found to rollback from");
    process.exit(1);
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("Backup manifest not found");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  console.log(`Rolling back from backup: ${backupDir}`);
  console.log(`Backup timestamp: ${manifest.timestamp}`);
  console.log(`Files to restore: ${manifest.files.length}`);

  for (const file of manifest.files) {
    const sourcePath = path.join(backupDir, file.path);
    const targetPath = path.join(devlogPath, file.path);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(sourcePath, targetPath);
    console.log(`  Restored: ${file.path}`);
  }

  console.log("\nRollback complete!");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

function executeCleanup(plan: CleanupPlan, devlogPath: string): void {
  let moved = 0;
  let deleted = 0;
  let archived = 0;
  let foldersDeleted = 0;

  // Create target folders
  for (const folder of Object.values(TARGET_FOLDERS)) {
    const folderPath = path.join(devlogPath, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  }

  // Execute move operations
  for (const op of plan.moveOperations) {
    const sourcePath = path.join(devlogPath, op.from);
    const targetPath = path.join(devlogPath, op.to);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.renameSync(sourcePath, targetPath);
      console.log(`  Moved: ${op.from} -> ${op.to}`);
      moved++;
    }
  }

  // Execute archive operations
  for (const op of plan.archiveOperations) {
    const sourcePath = path.join(devlogPath, op.from);
    const targetPath = path.join(devlogPath, op.to);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.renameSync(sourcePath, targetPath);
      console.log(`  Archived: ${op.from} -> ${op.to}`);
      archived++;
    }
  }

  // Execute delete operations (duplicates)
  for (const op of plan.deleteOperations) {
    const filePath = path.join(devlogPath, op.path);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  Deleted: ${op.path}`);
      deleted++;
    }
  }

  // Delete empty folders
  for (const folder of plan.emptyFolders.sort((a, b) => b.length - a.length)) {
    const folderPath = path.join(devlogPath, folder);

    if (fs.existsSync(folderPath)) {
      try {
        fs.rmdirSync(folderPath);
        console.log(`  Removed empty folder: ${folder}`);
        foldersDeleted++;
      } catch {
        // Folder not empty, skip
      }
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log("CLEANUP COMPLETE");
  console.log("═".repeat(60));
  console.log(`  Files moved:    ${moved}`);
  console.log(`  Files archived: ${archived}`);
  console.log(`  Files deleted:  ${deleted}`);
  console.log(`  Folders removed: ${foldersDeleted}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORTING
// ═══════════════════════════════════════════════════════════════════════════

function printDryRunReport(plan: CleanupPlan): void {
  console.log("\n" + "═".repeat(60));
  console.log("            DEVLOG CLEANUP PREVIEW (DRY RUN)");
  console.log("═".repeat(60));

  console.log("\nANALYSIS COMPLETE");
  console.log("─".repeat(60));
  console.log(`Files scanned:        ${plan.summary.totalFiles}`);
  console.log(`Root files to move:   ${plan.summary.rootFiles}`);
  console.log(`Duplicates found:     ${plan.summary.duplicates}`);
  console.log(`Old files to archive: ${plan.summary.toArchive}`);
  console.log(`Empty folders:        ${plan.summary.emptyFolders}`);

  if (plan.moveOperations.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("MOVE OPERATIONS (root files -> proper folders)");
    console.log("─".repeat(60));
    for (const op of plan.moveOperations.slice(0, 20)) {
      console.log(`  ${op.from}`);
      console.log(`    -> ${op.to}`);
    }
    if (plan.moveOperations.length > 20) {
      console.log(`  ... and ${plan.moveOperations.length - 20} more`);
    }
  }

  if (plan.duplicates.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("DUPLICATE FILES");
    console.log("─".repeat(60));
    for (const group of plan.duplicates.slice(0, 10)) {
      console.log(`  Keep: ${group.keep.relativePath}`);
      for (const file of group.remove) {
        console.log(`    Remove: ${file.relativePath}`);
      }
    }
    if (plan.duplicates.length > 10) {
      console.log(`  ... and ${plan.duplicates.length - 10} more duplicate groups`);
    }
  }

  if (plan.archiveOperations.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("ARCHIVE OPERATIONS (old files)");
    console.log("─".repeat(60));
    for (const op of plan.archiveOperations.slice(0, 10)) {
      console.log(`  ${op.from} -> ${op.to}`);
    }
    if (plan.archiveOperations.length > 10) {
      console.log(`  ... and ${plan.archiveOperations.length - 10} more`);
    }
  }

  if (plan.emptyFolders.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("EMPTY FOLDERS TO DELETE");
    console.log("─".repeat(60));
    for (const folder of plan.emptyFolders) {
      console.log(`  ${folder}/`);
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log("Run with --backup to create backup first");
  console.log("Run with --execute to apply changes");
  console.log("═".repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const options: CleanupOptions = {
    devlogPath: "",
    dryRun: args.includes("--dry-run"),
    backup: args.includes("--backup"),
    execute: args.includes("--execute"),
    rollback: args.includes("--rollback"),
    archiveAfterDays: 180, // 6 months
    verbose: args.includes("--verbose") || args.includes("-v"),
  };

  // Parse --devlog path
  const devlogIndex = args.indexOf("--devlog");
  if (devlogIndex !== -1 && args[devlogIndex + 1]) {
    options.devlogPath = args[devlogIndex + 1];
  }

  // Parse --archive-days
  const daysIndex = args.indexOf("--archive-days");
  if (daysIndex !== -1 && args[daysIndex + 1]) {
    options.archiveAfterDays = parseInt(args[daysIndex + 1], 10);
  }

  // Validate
  if (!options.devlogPath) {
    console.error("Usage: npx tsx scripts/cleanup.ts --devlog /path/to/devlog [options]");
    console.error("");
    console.error("Options:");
    console.error("  --dry-run        Preview changes without modifying files");
    console.error("  --backup         Create backup before making changes");
    console.error("  --execute        Apply changes (creates backup automatically)");
    console.error("  --rollback       Restore from latest backup");
    console.error("  --archive-days N Archive files older than N days (default: 180)");
    console.error("  --verbose, -v    Show detailed output");
    process.exit(1);
  }

  if (!fs.existsSync(options.devlogPath)) {
    console.error(`Devlog path not found: ${options.devlogPath}`);
    process.exit(1);
  }

  // Handle rollback
  if (options.rollback) {
    rollback(options.devlogPath);
    return;
  }

  console.log(`Scanning devlog: ${options.devlogPath}`);

  // Scan files
  const files = await scanDevlog(options.devlogPath);
  console.log(`Found ${files.length} markdown files`);

  // Create cleanup plan
  const plan = createCleanupPlan(files, options.devlogPath, options.archiveAfterDays);

  // Default to dry-run if no action specified
  if (!options.execute && !options.backup) {
    options.dryRun = true;
  }

  if (options.dryRun && !options.execute) {
    printDryRunReport(plan);
    return;
  }

  // Create backup before execution
  if (options.backup || options.execute) {
    console.log("\nCreating backup...");
    const backupDir = await createBackup(options.devlogPath);
    console.log(`Backup saved to: ${backupDir}`);

    if (options.backup && !options.execute) {
      console.log("\nBackup complete. Run with --execute to apply changes.");
      return;
    }
  }

  // Execute cleanup
  if (options.execute) {
    console.log("\nExecuting cleanup...\n");
    executeCleanup(plan, options.devlogPath);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
