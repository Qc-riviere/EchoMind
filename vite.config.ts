import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: false,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Split heavy/independent deps into their own chunks so the main bundle
    // isn't 1 MB. Helps cold-start and lets the webview cache vendor chunks
    // across reloads.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          // React + router rarely change → biggest cacheable win
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Graph viz: only loaded by GraphPage, ~250KB
          "vendor-graph": ["react-force-graph-2d"],
          // DOCX builder: only loaded when user clicks export, ~300KB
          "vendor-docx": ["docx"],
        },
      },
    },
  },
}));
