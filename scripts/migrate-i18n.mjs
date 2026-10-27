import ts from 'typescript';
import fs from 'node:fs';
const messages=JSON.parse(fs.readFileSync('src/i18n/messages/en.json','utf8'));
const files=['src/components/life-os.tsx','src/components/modules.tsx','src/components/event-editor.tsx','src/components/ui/dialog.tsx','src/app/error.tsx','src/app/loading.tsx'];
const allowedAttributes=new Set(['aria-label','title','placeholder','text','description','eyebrow']);
const technicalAttributes=new Set(['className','id','name','value','defaultValue','type','key','href','src','autoComplete']);
function component(node){for(let current=node.parent;current;current=current.parent)if(ts.isFunctionDeclaration(current)&&current.name&&/^[A-Z]/.test(current.name.text))return current;return null;}
for(const file of files){let text=fs.readFileSync(file,'utf8');if(text.includes('from "@/i18n/provider"'))throw new Error(`Already migrated ${file}`);const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const edits=[];const functions=[];
function edit(node,replacement){edits.push({start:node.getStart(source),end:node.end,replacement});}
function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.body&&node.name&&/^[A-Z]/.test(node.name.text))functions.push(node);
  const owner=component(node);
  if(owner&&ts.isJsxText(node)){const key=node.text.replace(/\s+/g,' ').trim();if(messages[key]!==undefined){const prefix=/^\s/.test(node.text)?' ':'';const suffix=/\s$/.test(node.text)?' ':'';edits.push({start:node.pos,end:node.end,replacement:`${prefix}{tr(${JSON.stringify(key)})}${suffix}`});}return;}
  if(owner&&ts.isJsxAttribute(node)){const name=node.name.getText(source);if(node.initializer&&ts.isStringLiteral(node.initializer)&&allowedAttributes.has(name)&&messages[node.initializer.text]!==undefined){edit(node.initializer,`{tr(${JSON.stringify(node.initializer.text)})}`);return;}if(technicalAttributes.has(name))return;}
  if(owner&&ts.isStringLiteral(node)&&!ts.isJsxAttribute(node.parent)&&!ts.isArrayLiteralExpression(node.parent)&&messages[node.text]!==undefined){
    // These are canonical workout/experience values, never presentation labels.
    if(['Push','Pull','Legs','Upper','Lower','Full Body','Cardio','Badminton','Rest Day','Custom Workout','Beginner','Intermediate','Advanced'].includes(node.text))return;
    edit(node,`tr(${JSON.stringify(node.text)})`);return;
  }
  if(owner&&ts.isTemplateExpression(node)){
    let key=node.head.text;node.templateSpans.forEach((span,i)=>key+=`{p${i}}`+span.literal.text);
    if(messages[key]!==undefined){edit(node,`tr(${JSON.stringify(key)}, {${node.templateSpans.map((span,i)=>`p${i}: ${span.expression.getText(source)}`).join(', ')}})`);return;}
  }
  ts.forEachChild(node,visit);
}visit(source);
for(const fn of functions){const names=file.endsWith('modules.tsx')?'t:tr,message,issue,language,formatDuration,formatTime,calendarDayLabel:dayLabel,humanCategory':file.endsWith('life-os.tsx')?'t:tr,message,issue,language,setLanguage,formatDuration,formatTime,dayLabel,timeRange,relativeDay':'t:tr,message,issue,language';edits.push({start:fn.body.getStart(source)+1,end:fn.body.getStart(source)+1,replacement:`\n  const {${names}}=useI18n();\n`});}
edits.sort((a,b)=>b.start-a.start);let previous=Infinity;for(const e of edits){if(e.end>previous)throw new Error(`Overlapping edits ${file}:${e.start}`);text=text.slice(0,e.start)+e.replacement+text.slice(e.end);previous=e.start;}
if(!text.startsWith('"use client"')&&!text.startsWith("'use client'"))text='"use client";\n'+text;
const marker=text.indexOf('\n');text=text.slice(0,marker+1)+'import {useI18n} from "@/i18n/provider";\n'+text.slice(marker+1);fs.writeFileSync(file,text);console.log(`${file}: ${edits.length} edits`);
}
