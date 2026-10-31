import { defineConfig } from "vite";

export default defineConfig({
  cacheDir: "node_modules/.vite",
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: true,
    outDir: "dist/server",
    emptyOutDir: true,
    target: "node24",
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      input: { main: "src/server/main.ts" },
      output: { entryFileNames: "[name].js", chunkFileNames: "shared-[hash].js" },
    },
  },
});
