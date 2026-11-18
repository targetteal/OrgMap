import config from './vite.config.ts';
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({...config,build:{...config.build,outDir:fileURLToPath(new URL('./evidence/browser-candidate-v2/',import.meta.url))}});
