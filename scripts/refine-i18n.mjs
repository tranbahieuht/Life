import fs from 'node:fs';
import ts from 'typescript';
for(const file of ['src/components/life-os.tsx','src/components/modules.tsx','src/components/event-editor.tsx','src/components/ui/dialog.tsx','src/app/error.tsx','src/app/loading.tsx']){
 let text=fs.readFileSync(file,'utf8').replaceAll('t:tr,message,issue','t:tr,message:localizeMessage,issue');
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const edits=[];
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='tr'&&node.arguments[0]?.getText(source)==='"completed"'&&!ts.isJsxExpression(node.parent)){edits.push({start:node.getStart(source),end:node.end,text:'"completed"'});return;}ts.forEachChild(node,visit);}visit(source);
 for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
 fs.writeFileSync(file,text);
}
