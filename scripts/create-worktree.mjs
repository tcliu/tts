#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";

import { c } from "./_terminal.mjs";
import {
  copyDevFiles,
  deleteBranch,
  getWorktreesRoot,
  isValidBranchName,
  registerWorktree,
  removeWorktree,
  setDevTag,
} from "./_worktrees.mjs";

function printUsage() {
  console.log(`${c.bold}Usage:${c.reset}`);
  console.log("  node scripts/create-worktree.mjs <branch>");
  console.log("  node scripts/create-worktree.mjs --interactive");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  const positional = args.filter((arg) => !arg.startsWith("-"));
  return {
    interactive:
      args.includes("--interactive") ||
      args.includes("-i") ||
      positional.length === 0,
    branch: positional[0] ?? null,
  };
}

async function promptBranchName(root) {
  const rl = createInterface({ input, output });
  const prompt = `${c.cyan}Branch name${c.reset} (${c.dim}leave empty to cancel${c.reset}): `;
  process.stdout.write(prompt);

  for await (const line of rl) {
    const answer = line.trim();
    if (!answer) {
      rl.close();
      return null;
    }
    if (!isValidBranchName(answer)) {
      console.error(`${c.red}Invalid branch name:${c.reset} ${answer}`);
    } else if (existsSync(path.join(getWorktreesRoot(root), answer))) {
      console.error(`${c.red}Worktree already exists:${c.reset} ${answer}`);
    } else {
      rl.close();
      return answer;
    }
    process.stdout.write(prompt);
  }
  rl.close();
  return null;
}

async function main() {
  const root = process.cwd();
  if (path.resolve(root).split(path.sep).includes(".worktrees")) {
    console.error(
      `${c.red}Run this script from the default worktree, not a nested worktree.${c.reset}`,
    );
    process.exit(1);
  }

  const { interactive, branch } = parseArgs(process.argv);

  let branchName = branch;
  if (interactive) {
    branchName = await promptBranchName(root);
    if (!branchName) {
      console.log(`${c.yellow}Cancelled.${c.reset}`);
      return;
    }
  }

  if (!isValidBranchName(branchName)) {
    console.error(`${c.red}Invalid branch name:${c.reset} ${branchName}`);
    process.exit(1);
  }

  const worktreeDir = path.join(getWorktreesRoot(root), branchName);
  if (existsSync(worktreeDir)) {
    console.error(`${c.red}Worktree already exists:${c.reset} ${worktreeDir}`);
    process.exit(1);
  }

  try {
    registerWorktree(root, worktreeDir, branchName);
  } catch (error) {
    console.error(
      `${c.red}Failed to create worktree:${c.reset} ${error.message}`,
    );
    process.exit(1);
  }

  try {
    copyDevFiles(root, worktreeDir);
    setDevTag(worktreeDir, branchName);
  } catch (error) {
    console.error(
      `${c.red}Failed to set up worktree:${c.reset} ${error.message}`,
    );
    cleanupWorktree(root, worktreeDir, branchName);
    process.exit(1);
  }

  console.log(`\n${c.green}Worktree created:${c.reset} ${worktreeDir}`);
  console.log(
    `${c.green}DEV_TAG=${branchName}${c.reset} set in ${path.join(worktreeDir, ".env.local")}`,
  );
}

function cleanupWorktree(root, worktreeDir, branchName) {
  if (!removeWorktree(root, { path: worktreeDir })) {
    console.error(
      `${c.red}Failed to remove incomplete worktree:${c.reset} ${worktreeDir}`,
    );
  }
  if (!deleteBranch(root, branchName)) {
    console.error(`${c.red}Failed to delete branch:${c.reset} ${branchName}`);
  }
}

main().catch((error) => {
  console.error(`${c.red}${error.message}${c.reset}`);
  process.exit(1);
});
