import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import {dictionaries} from '../src/i18n/core';

describe('presentation translation coverage',()=>{
  it('has no untranslated fixed JSX copy or missing literal resource keys',()=>{
    const files=['src/components/life-os.tsx','src/components/modules.tsx','src/components/event-editor.tsx','src/components/ui/dialog.tsx','src/app/error.tsx','src/app/loading.tsx','src/app/not-found.tsx'];
    const allowed=new Set(['L','LIFE','OS','LIFE OS','kcal','kg','GEMINI_API_KEY','.env.local','⌘ K']);const issues:string[]=[];
    for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(node:ts.Node){
      if(ts.isJsxText(node)){const text=node.text.replace(/\s+/g,' ').trim();if(/[A-Za-z]/.test(text)&&!allowed.has(text))issues.push(`${file}: fixed text ${text}`);}
      if(ts.isJsxAttribute(node)&&['title','text','description','eyebrow','placeholder','aria-label'].includes(node.name.getText(source))&&node.initializer&&ts.isStringLiteral(node.initializer)&&node.initializer.text!=='you@example.com')issues.push(`${file}: untranslated attribute ${node.initializer.text}`);
      if(ts.isCallExpression(node)&&['tr','t'].includes(node.expression.getText(source))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&!Object.hasOwn(dictionaries.en,node.arguments[0].text))issues.push(`${file}: missing key ${node.arguments[0].text}`);
      ts.forEachChild(node,visit);
    }visit(source);}
    expect(issues).toEqual([]);
  });
});
