#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export function getWorktreesRoot(root = process.cwd()) {
  return path.join(root, ".worktrees");
}

export function getMainRoot(root = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

export function getGitWorktrees(root = process.cwd()) {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root,
    encoding: "utf-8",
    stdio: "pipe",
  });
  const worktrees = [];
  let current = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) worktrees.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      continue;
    }
    if (line === "") {
      if (current.path) worktrees.push(current);
      current = null;
    }
  }

  if (current?.path) worktrees.push(current);
  return worktrees.map((worktree) => ({
    ...worktree,
    path: path.resolve(worktree.path),
    name: path.relative(getWorktreesRoot(root), path.resolve(worktree.path)),
  }));
}

export function hasGitEntry(dir) {
  return existsSync(path.join(dir, ".git"));
}

export function listNestedGitDirs(root = process.cwd()) {
  const worktreesRoot = getWorktreesRoot(root);
  if (!existsSync(worktreesRoot)) return [];

  const results = [];

  function scan(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === ".vercel" ||
        entry === ".svelte-kit" ||
        entry.startsWith(".fuse_hidden")
      )
        continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (hasGitEntry(full)) {
        results.push({
          path: path.resolve(full),
          name: path.relative(worktreesRoot, path.resolve(full)),
        });
        continue;
      }
      scan(full);
    }
  }

  scan(worktreesRoot);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function listCopyTargets(root = process.cwd()) {
  return listNestedGitDirs(root);
}

export function listDeleteTargets(root = process.cwd()) {
  const registered = new Map(
    getGitWorktrees(root).map((worktree) => [worktree.path, worktree]),
  );
  return listNestedGitDirs(root).map((item) => {
    const registeredEntry = registered.get(item.path);
    if (registeredEntry) return registeredEntry;
    return {
      ...item,
      branch: readBranchFromGitDir(item.path),
      registered: false,
    };
  });
}

// Every checkout except the main one, each annotated with its commit diffs
// relative to the base branch. Mirrors `references/worktrees.mjs`
// `listWorktrees`: `{ base, entries }` with entries `[{ name, path, branch,
// registered, ahead, behind, lastCommitTime }]` newest-first. Uses the local
// exported primitives (`listNestedGitDirs`, `getGitWorktrees`) so there is
// exactly one implementation of each git query in this file.
export function listWorktrees(root = process.cwd()) {
  const mainRoot = path.resolve(getMainRoot(root));
  const base = resolveBaseBranch(root);
  const registered = new Map(
    getGitWorktrees(root).map((worktree) => [worktree.path, worktree]),
  );
  const entries = [];
  for (const item of listNestedGitDirs(root)) {
    if (item.path === mainRoot) continue;
    const registeredEntry = registered.get(item.path);
    const branch = registeredEntry?.branch ?? readBranchFromGitDir(item.path);
    const counts = getAheadBehind(root, base, branch, registeredEntry ? true : false);
    entries.push({
      name: item.name,
      path: item.path,
      branch,
      registered: Boolean(registeredEntry),
      ahead: counts?.ahead ?? null,
      behind: counts?.behind ?? null,
      lastCommitTime: getLastCommitTime(item.path),
    });
  }
  entries.sort((a, b) => (b.lastCommitTime ?? -1) - (a.lastCommitTime ?? -1));
  return { base, entries };
}

export function listRegisterTargets(root = process.cwd()) {
  const registered = new Set(
    getGitWorktrees(root).map((worktree) => worktree.path),
  );
  return listNestedGitDirs(root).filter((item) => !registered.has(item.path));
}

export function readBranchFromGitDir(worktreePath) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}

export function resolveBaseBranch(root = process.cwd()) {
  try {
    const ref = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    const name = ref.replace("refs/remotes/origin/", "");
    if (name && name !== "HEAD" && name !== ref) return name;
  } catch {}
  for (const cand of ["main", "master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", `refs/heads/${cand}`], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return cand;
    } catch {}
  }
  return null;
}

// Commits the branch is ahead of / behind the base (both repo-global names,
// resolved in root). Null when unresolvable; skipped for the main row,
// detached HEAD, and unregistered dirs (foreign .git names may collide).
export function getAheadBehind(root, base, branch, registered = true) {
  if (!base || !branch || branch === base || branch === "HEAD") return null;
  if (registered === false) return null;
  try {
    const out = execFileSync(
      "git",
      ["rev-list", "--left-right", "--count", `${base}...${branch}`],
      { cwd: root, encoding: "utf-8", stdio: "pipe" },
    ).trim();
    const [behind, ahead] = out.split(/\s+/).map(Number);
    if (Number.isNaN(behind) || Number.isNaN(ahead)) return null;
    return { ahead, behind };
  } catch {
    return null;
  }
}

// Unix timestamp of a worktree's HEAD commit, resolved inside its own path
// (correct for unregistered dirs too). Null when unresolvable.
export function getLastCommitTime(worktreePath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct"], {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    const t = Number(out);
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

export function registerWorktree(root, worktreePath, branch) {
  execFileSync("git", ["worktree", "add", worktreePath, "-b", branch], {
    cwd: root,
    stdio: "pipe",
  });
}

export function removeWorktree(root, worktree) {
  const mainRoot = getMainRoot(root);
  if (path.resolve(worktree.path) === mainRoot) {
    return false;
  }

  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree.path], {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    try {
      rmSync(worktree.path, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

export function deleteBranch(root, branch) {
  if (!branch) return false;
  try {
    execFileSync("git", ["branch", "-D", branch], {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function isValidBranchName(name) {
  return (
    /^[a-zA-Z0-9._/-]+$/.test(name) &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.includes("..")
  );
}

function parseDotenv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    values[key] = trimmed.slice(separatorIndex + 1).trim();
  }
  return values;
}

export function setDevTag(worktreeRoot, tag) {
  const filePath = path.join(worktreeRoot, ".env.local");
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const values = parseDotenv(content);
  const entry = `DEV_TAG=${tag}`;
  if (!Object.prototype.hasOwnProperty.call(values, "DEV_TAG")) {
    writeFileSync(
      filePath,
      content.replace(/\s*$/, "") + (content.trim() ? "\n" : "") + `${entry}\n`,
    );
    return;
  }
  const output = content.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return line;
    if (trimmed.slice(0, separatorIndex).trim() !== "DEV_TAG") return line;
    return entry;
  });
  writeFileSync(filePath, output.join("\n") + "\n");
}

export function copyDevFiles(sourceRoot, targetRoot) {
  // Returns the worktree-relative names of what was actually copied, so
  // callers can report it (skipped files are omitted, not listed).
  const copied = [];
  for (const file of ['.env', '.env.local']) {
    if (copyEnvFile(path.join(sourceRoot, file), path.join(targetRoot, file))) {
      copied.push(file);
    }
  }
  migrateLegacyDevTag(sourceRoot, targetRoot);
  return copied;
}

// `.env.dev` used to carry DEV_TAG before it merged into `.env.local`.
// One-way forward migration so old worktrees keep their tag block.
function migrateLegacyDevTag(sourceRoot, targetRoot) {
  if (readDevTag(targetRoot)) return;
  const legacyPath = path.join(sourceRoot, '.env.dev');
  if (!existsSync(legacyPath)) return;
  const content = readFileSync(legacyPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    if (trimmed.slice(0, separatorIndex).trim() === 'DEV_TAG') {
      setDevTag(targetRoot, trimmed.slice(separatorIndex + 1).trim());
      return;
    }
  }
}

// Copies only when the source exists and the target is missing (never
// overwrites). Returns true when a copy happened.
function copyEnvFile(sourceEnv, targetEnv) {
  if (existsSync(sourceEnv) && !existsSync(targetEnv)) {
    copyFileSync(sourceEnv, targetEnv);
    return true;
  }
  return false;
}

export function readDevTag(worktreeRoot) {
  for (const file of ['.env.local', '.env.dev']) {
    const envPath = path.join(worktreeRoot, file);
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;
      if (trimmed.slice(0, separatorIndex).trim() === 'DEV_TAG') {
        return trimmed.slice(separatorIndex + 1).trim();
      }
    }
  }
  return null;
}
