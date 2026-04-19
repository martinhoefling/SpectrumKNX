import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Try to get git version, fallback to 'dev'
let gitVersion = 'dev'
try {
  gitVersion = execSync('git describe --tags --always').toString().trim()
} catch {
  // Ignore
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env instead of just those starting with `VITE_`.
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8000';
  const wsBackendUrl = backendUrl.replace(/^http/, 'ws');
  const appVersion = process.env.VITE_APP_VERSION || env.VITE_APP_VERSION || gitVersion;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: wsBackendUrl,
          ws: true,
        },
      },
    },
  }
})
