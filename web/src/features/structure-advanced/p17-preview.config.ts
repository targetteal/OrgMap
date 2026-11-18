import {defineConfig} from "vite";
export default defineConfig({root:process.cwd()+"/web",server:{host:"127.0.0.1",port:5197,strictPort:true,watch:{ignored:["**/*"]},allowedHosts:["p17.localhost"],proxy:{"/api":{target:"http://127.0.0.1:3037",changeOrigin:false}}}});
