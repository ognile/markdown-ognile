import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export default defineConfig([
  {
    entry: ['src/extension.ts'],
    format: ['cjs'],
    outDir: 'dist',
    external: ['vscode'],
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/webview/main.ts'],
    format: ['iife'],
    outDir: 'dist/webview',
    sourcemap: true,
    globalName: 'ognileWebview',
    onSuccess: async () => {
      // Copy CSS files to dist/webview
      const stylesDir = 'src/webview/styles';
      const outDir = 'dist/webview';
      mkdirSync(outDir, { recursive: true });
      try {
        const files = readdirSync(stylesDir);
        const cssContents: string[] = [];
        for (const file of files) {
          if (file.endsWith('.css')) {
            const { readFileSync } = await import('fs');
            cssContents.push(readFileSync(join(stylesDir, file), 'utf-8'));
          }
        }
        const { writeFileSync } = await import('fs');
        writeFileSync(join(outDir, 'styles.css'), cssContents.join('\n'));
      } catch {}
    },
  },
]);
