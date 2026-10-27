import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);
const env={...process.env};
// Some managed Windows machines disallow native compiler DLLs. Use Next's
// official WASM bindings with webpack on those machines; keep native elsewhere.
if(process.platform==='win32'){
  try{require('@next/swc-win32-x64-msvc');}
  catch{env.NEXT_TEST_WASM_DIR=dirname(require.resolve('@next/swc-wasm-nodejs'));}
}
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),...process.argv.slice(2)],{stdio:'inherit',env,cwd:resolve('.')});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
