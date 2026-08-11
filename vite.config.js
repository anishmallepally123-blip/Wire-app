import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base means this works at any GitHub Pages path
// (user site, project site, custom domain) with no edits.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
