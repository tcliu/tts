import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Vite exposes only VITE_* to the client and never puts dotenv values into
// the server's process.env, but server code reads process.env directly.
// Fill missing keys from the gitignored local files for `vite dev` only;
// real environment always wins. `.env.dev` was merged into `.env.local`.
const DEV_ENV_FILES = [".env", ".env.local"];

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadDevEnv() {
  const merged: Record<string, string> = {};
  for (const file of DEV_ENV_FILES) {
    const entries = Object.entries(
      parseEnvFile(path.resolve(process.cwd(), file)),
    ) as [string, string][];
    for (const [key, value] of entries) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore vitest projects typed via vitest/config but checked via vite types
export default defineConfig(async ({ command, mode }) => {
  if (command === "serve" && mode === "development") {
    loadDevEnv();
  }
  return {
    plugins: [sveltekit(), tailwindcss()],
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "client",
            include: ["src/**/*.{test,spec}.{ts,js}"],
            exclude: [
              "src/lib/server/**/*.test.ts",
              "src/lib/server/**/*.spec.ts",
              "src/lib/doc-route-drawer.test.ts",
              "src/lib/speed-parity.test.ts",
              "src/lib/tailwind-source.test.ts",
              "src/lib/theme-parity.test.ts",
              "src/lib/toolbar-ladder.test.ts",
            ],
            environment: "jsdom",
            globals: true,
            setupFiles: ["./src/test/vitest-setup.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "server",
            include: [
              "src/lib/server/**/*.test.ts",
              "src/lib/server/**/*.spec.ts",
              "src/lib/doc-route-drawer.test.ts",
              "src/lib/tailwind-source.test.ts",
              "src/lib/theme-parity.test.ts",
              "src/lib/speed-parity.test.ts",
              "src/lib/toolbar-ladder.test.ts",
            ],
            environment: "node",
            globals: true,
          },
        },
      ],
    },
  };
});
