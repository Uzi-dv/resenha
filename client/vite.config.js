import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `import data from 'x.wasm?b64'` → string base64 do binário.
 * Embute o wasm no bundle: o Electron empacotado carrega de file://, onde fetch() não funciona.
 */
function wasmBase64() {
  const PREFIX = '\0wasm-b64:'
  return {
    name: 'resenha-wasm-base64',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.wasm?b64')) return null
      const resolved = await this.resolve(source.slice(0, -'?b64'.length), importer, { skipSelf: true })
      return resolved ? PREFIX + resolved.id : null
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      return `export default ${JSON.stringify(readFileSync(id.slice(PREFIX.length)).toString('base64'))}`
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    wasmBase64(),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})
