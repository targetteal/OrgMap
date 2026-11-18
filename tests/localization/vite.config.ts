import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('../../web/',import.meta.url)),
 cacheDir:fileURLToPath(new URL('./.vite-cache/',import.meta.url)),
 build:{outDir:fileURLToPath(new URL('./evidence/browser-candidate/',import.meta.url)),emptyOutDir:true,manifest:true},
 server:{host:'127.0.0.1',port:5188,strictPort:true,allowedHosts:['a11y.localhost'],proxy:{
  '/api':{target:'http://127.0.0.1:3028',changeOrigin:false,ws:true},
  '/public':{target:'http://127.0.0.1:3028',changeOrigin:false},
 }},
 preview:{host:'127.0.0.1',port:5188,strictPort:true,allowedHosts:['a11y.localhost'],proxy:{
  '/api':{target:'http://127.0.0.1:3028',changeOrigin:false,ws:true},
  '/public':{target:'http://127.0.0.1:3028',changeOrigin:false},
 }},
});
