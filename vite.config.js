import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE || "/repair-dashboard/",
  plugins: [react()],
  server: {
    proxy: {
      "/local-api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        secure: false
      },
      "/api": {
        target: "https://api.aiguanji.com",
        changeOrigin: true,
        secure: true
      }
    }
  }
});