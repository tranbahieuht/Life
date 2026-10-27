import fs from 'node:fs';import ts from 'typescript';
for(const file of ['src/app/api/data/route.ts','src/app/api/plan/route.ts']){
 let text=fs.readFileSync(file,'utf8');const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const edits=[];
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='fail'&&node.arguments.length===2)edits.push({start:node.end-1,end:node.end-1,value:', request'});ts.forEachChild(node,visit);}visit(source);for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.value+text.slice(e.end);
 text='import {localizeMessage,requestLanguage} from "@/i18n/core";\n'+text;
 text=text.replace('const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });','const fail = (error:string,status:number,request:Request)=>NextResponse.json({error:localizeMessage(requestLanguage(request),error,true),errorKey:error},{status,headers});');
 fs.writeFileSync(file,text);
}
const file='src/hooks/use-life-data.ts';let text=fs.readFileSync(file,'utf8').replaceAll('result.error ||','result.errorKey || result.error ||');fs.writeFileSync(file,text);
