import { defineConfig, loadEnv } from 'vite'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { alphaTab } from '@coderline/alphatab-vite'
import { fretwiseServer } from './server/fretwise-server'

export default defineConfig(({ mode }) => {
  // Make ANTHROPIC_API_KEY and FRETWISE_DB_URL from .env.local available to the local API. Never to the
  // browser: Vite only puts VITE_ variables in the page.
  const env = loadEnv(mode, process.cwd(), ['ANTHROPIC_', 'FRETWISE_'])
  Object.assign(process.env, env)
  return {
    // React Compiler: memoizes components and hooks automatically, so the tab, meters and scoring
    // redraw only what changed while you play.
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), alphaTab(), fretwiseServer()],
    server: {
      open: true,
      // Listen on the Wi-Fi too, so bandmates can join a live session from their phones.
      host: true,
      // Never serve secrets or local data to other devices (.env.local holds the API key).
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cache/**'] },
      // Local data and the auto-sync helper's Python install change often; they aren't app code.
      watch: { ignored: ['**/.cache/**'] },
    },
    // The NAM engine locates its worklet and wasm files via import.meta.url; keep it out of pre-bundling.
    optimizeDeps: { exclude: ['neural-amp-modeler-wasm'] },
  }
})
