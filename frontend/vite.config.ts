import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pages-only 정적 빌드: base '/', 출력 dist.
// Pages 프로젝트 plustree-memo의 빌드 설정: Framework preset Vite,
// Build command `npm run build`, Output directory `dist`.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
