import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const allowedHosts = [
  'silk-road-logistics-crm-579021695433.asia-east1.run.app',
  'silk-road-logistics-crm.ai.studio',
];

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: Number(process.env.PORT || 3000),
      allowedHosts,
      fs: {
        deny: ['.env', '.env.*', '.secret.local', '*.{crt,pem}', '**/.git/**', '**/server/**', '**/functions/**', '**/scratch/**', '**/serviceAccountKey.json', '**/service-account.json', '**/*-firebase-adminsdk-*.json'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/server/data/**', '**/node_modules/**', '**/.git/**'],
      },
    },
    preview: { port: Number(process.env.PORT || 3000), allowedHosts },
  };
});
