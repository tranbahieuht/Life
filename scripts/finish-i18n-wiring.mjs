import fs from 'node:fs';
let file='src/components/life-os.tsx';let s=fs.readFileSync(file,'utf8');s=s.replace('>Show all activities</button>','>{tr("Show all activities")}</button>');s=s.replace('createDemoData(today)','createDemoData(today,language)');s=s.replace('document.documentElement.lang=data.preferences.language;','');s=s.replace('{error&&<p className="form-error" role="alert">{error}</p>}','{error&&<p className="form-error" role="alert">{localizeMessage(error,true)}</p>}');
// Remove the superseded bilingual branches; all presentation is now resource-driven.
s=s.replace(/  const greeting=vi\?[^\n]+\n/,'');
fs.writeFileSync(file,s);
file='src/components/modules.tsx';s=fs.readFileSync(file,'utf8');
s=s.replace('title="Make movement a ritual"','title={tr("Make movement a ritual")}').replace('>Create your first plan</button>','>{tr("Create your first plan")}</button>');
s=s.replace('{scheduled.length} scheduled session{scheduled.length > 1 ? "s" : ""}','{tr("tasks.sessions",{count:scheduled.length})}');
s=s.replace('{tr("Exercise")} {i + 1}', '{tr("workout.exercise",{count:i+1})}');
s=s.replace('{tr("Planned rest:")} {x.restSeconds}{tr("s between sets")}', '{tr("workout.rest",{seconds:x.restSeconds})}');
s=s.replace('{tr("Planned rest:")} {x.restSeconds}s between sets','{tr("workout.rest",{seconds:x.restSeconds})}');
s=s.replace('{data.events.filter(e => e.fixed).length} {tr("fixed activities protected")}','{data.events.filter(e => e.fixed).length} {tr("fixed activities protected")}');
s=s.replace('p1: k}', 'p1: tr(k===\'startTime\'?\'Starts at\':\'Ends at\')}');
fs.writeFileSync(file,s);
file='src/components/event-editor.tsx';s=fs.readFileSync(file,'utf8');s=s.replace("import {lifeEventSchema} from '@/lib/validation';", "import {lifeEventSchema} from '@/lib/validation';\nimport {parseQuickEntry} from '@/lib/quick-add';");
const start=s.indexOf('function parseQuick(');const end=s.indexOf('\nexport function EventEditor',start);if(start>=0)s=s.slice(0,start)+s.slice(end);
s=s.replace("const [approved,setApproved]=useState(false);", "const [approved,setApproved]=useState(false);const [needsTimeReview,setNeedsTimeReview]=useState(false);");
s=s.replace('const submit=(values:FormValues)=>{','const submit=(values:FormValues)=>{\n    if(needsTimeReview){setNotice(tr("quick.ambiguous"));return;}');
const oldStart=s.indexOf('const parsed=parseQuick(quick,selectedDate);');const oldEnd=s.indexOf('}}>\n',oldStart);
// Replace the quick-fill handler, leaving the surrounding form unchanged.
if(oldStart>=0){const stop=s.indexOf('}}>',oldStart);const old=s.slice(oldStart,stop);s=s.slice(0,oldStart)+`const result=parseQuickEntry(quick,selectedDate);const parsed=result.draft;previousDate.current=parsed.date;Object.entries(parsed).forEach(([k,v])=>setValue(k as keyof FormValues,v as never));setNeedsTimeReview(result.needsClarification);if(result.needsClarification){setValue('startTime','');setValue('endTime','');}setNotice(result.ambiguousHour?tr('quick.ambiguousHour',{hour:result.ambiguousHour,afternoon:result.ambiguousHour%12+12}):tr(result.needsClarification?'quick.incomplete':'quick.review'));`+s.slice(stop);}
s=s.replace('onChange={()=>{setApproved(false);setOverlaps([]);setNotice(\'\');}}','onChange={()=>{setApproved(false);setOverlaps([]);setNotice(\'\');if(form.getValues(\'startTime\')&&form.getValues(\'endTime\'))setNeedsTimeReview(false);}}');
fs.writeFileSync(file,s);
