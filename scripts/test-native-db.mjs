import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname,resolve } from 'node:path';
const require=createRequire(import.meta.url);
const bin=resolve(dirname(require.resolve('vitest/package.json')),require('vitest/package.json').bin.vitest);
const child=spawn(process.execPath,[bin,'run','tests/database-native.test.ts'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,LIFE_OS_NATIVE_PG:'1'},
});
child.on('exit',code=>{process.exitCode=code??1;});
child.on('error',()=>{console.error('Could not start the isolated native database test runner.');process.exitCode=1;});
