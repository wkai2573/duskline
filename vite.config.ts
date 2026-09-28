import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相對路徑：建置結果放到任何子目錄（例如 GitHub Pages）都能直接開
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
