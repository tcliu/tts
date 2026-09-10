import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Vite exposes only VITE_* to the client and never puts dotenv values into
// the server's process.env, but server code reads process.env directly.
// Fill missing keys from the dotenv files (`loadEnv` handles .env,
// .env.local, .env.[mode], .env.[mode].local precedence) for `vite dev`
// only; real environment always wins.
function loadDevEnv(mode: string) {
  const fileValues = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(fileValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore vitest projects typed via vitest/config but checked via vite types
export default defineConfig(async ({ command, mode }) => {
  if (command === "serve" && mode === "development") {
    loadDevEnv(mode);
  }
  return {
    plugins: [sveltekit(), tailwindcss()],
    server: {
      watch: {
        ignored: [
          '**/.vercel/**',
          '**/.data/**',
          '**/.tmp/**',
          '**/.svelte-kit/**',
          '**/coverage/**',
          '**/.git/**',
        ],
      },
    },
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
