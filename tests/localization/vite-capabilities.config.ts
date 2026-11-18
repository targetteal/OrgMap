import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../web/',import.meta.url)),build:{outDir:fileURLToPath(new URL('./evidence/capability-fixture/',import.meta.url)),emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('../../web/src/accessibility/verification.html',import.meta.url))}},preview:{host:'127.0.0.1',port:5198,strictPort:true,allowedHosts:['a11y.localhost']}});
