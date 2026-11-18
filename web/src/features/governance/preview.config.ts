import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
const proxy={'/api':'http://127.0.0.1:3016'};
export default defineConfig({root:fileURLToPath(new URL('../../../',import.meta.url)),build:{outDir:fileURLToPath(new URL('./.preview-dist',import.meta.url))},server:{host:'127.0.0.1',port:5186,strictPort:true,proxy},preview:{host:'127.0.0.1',port:5186,strictPort:true,proxy}});
