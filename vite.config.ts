import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import os from 'node:os'

const isElectronBuild = process.env.BUILD_TARGET === 'electron'
const isWindows = os.platform() === 'win32'

const config = defineConfig(({ mode }) => {
  const isTest = mode === 'test' || process.env.VITEST === 'true'

  return {
    test: {
      teardownTimeout: 1000,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      // Vitest only needs path resolution and TSX transforms. Disabling app
      // runtime plugins avoids Windows-specific Nitro bootstrap failures.
      ...(!isTest
        ? [
            devtools(),
            nitro({
              rollupConfig: { external: [/^@sentry\//, 'canvas', 'jsdom', 'cssstyle'] },
              serverDir: './server',
              preset: 'node-server',
              // Windows 上禁用 worker，使用内联模式避免 named pipe 问题
              ...(isWindows && { devServer: { watch: [] } }),
            }),
            tailwindcss(),
            tanstackStart(),
          ]
        : []),
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      viteReact(),
    ],
  }
})

export default config
