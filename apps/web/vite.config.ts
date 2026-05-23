import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 0.0.0.0 — 绑所有网卡, 同 WiFi 的设备能通过 http://<本机 IP>:5173 访问
    host: "0.0.0.0",
    proxy: {
      "/api": "http://127.0.0.1:3001"
    }
  }
});
