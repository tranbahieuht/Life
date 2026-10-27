"use client";
import {useI18n} from "@/i18n/provider";
import {useEffect,useRef,useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {AlertTriangle, CalendarDays, Check, Clock3, MapPin, Repeat2, Sparkles} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {categories,type AppData,type LifeEvent} from '@/lib/types';
import {eventInstants,eventsForDate,findConflicts,shiftDate,timeToMinutes} from '@/lib/schedule';
import {lifeEventSchema} from '@/lib/validation';
import {parseQuickEntry} from '@/lib/quick-add';

const formSchema=z.object({title:z.string().trim().min(1,'Give your activity a name.').max(200),description:z.string().max(4000),category:z.enum(categories),date:z.string().min(1),endDate:z.string().min(1),startTime:z.string().min(1),endTime:z.string().min(1),location:z.string().max(500),notes:z.string().max(10000),fixed:z.boolean(),repeat:z.boolean(),until:z.string(),days:z.array(z.number()),reminder:z.string(),customReminder:z.number().int().min(0).max(1440),checklist:z.string().max(10000),instructor:z.string().max(200)});
type FormValues=z.infer<typeof formSchema>;
export type EditorRequest={event?:LifeEvent;defaults?:Partial<LifeEvent>};

export function saveOccurrence(events:LifeEvent[],original:LifeEvent|undefined,value:LifeEvent,scope:'one'|'series'='one'):LifeEvent[]{
  if(original?.parentId&&original.id.includes('::')){
    const series=events.find(e=>e.id===original.parentId);
    if(scope==='series'&&series){
      const daySpan=value.endDate?Math.round((Date.parse(value.endDate+'T12:00:00Z')-Date.parse(value.date+'T12:00:00Z'))/86400000):0;
      const next={...value,id:series.id,date:series.date,endDate:shiftDate(series.date,daySpan),parentId:undefined,recurrence:value.recurrence,excludedDates:series.excludedDates,status:series.status};
      const checked=lifeEventSchema.parse(next);
      return events.map(e=>e.id===series.id?checked:e);
    }
    const child={...value,id:crypto.randomUUID(),parentId:original.parentId,recurrence:undefined,excludedDates:undefined};
    return [...events.map(e=>e.id===original.parentId?{...e,excludedDates:[...new Set([...(e.excludedDates||[]),original.date])]}:e),child];
  }
  return original?events.map(e=>e.id===original.id?value:e):[...events,value];
}


export function EventEditor({request,data,selectedDate,onClose,onSave}:{request:EditorRequest;data:AppData;selectedDate:string;onClose:()=>void;onSave:(event:LifeEvent,original?:LifeEvent,scope?:'one'|'series')=>void}){
  const {t:tr,message:localizeMessage,issue,language,humanCategory}=useI18n();

  const initial=request.event||request.defaults||{};const [scope,setScope]=useState<'one'|'series'>('one');const [quick,setQuick]=useState('');const [notice,setNotice]=useState('');const [overlaps,setOverlaps]=useState<string[]>([]);const [approved,setApproved]=useState(false);const [needsTimeReview,setNeedsTimeReview]=useState(false);
  const startDate=initial.date||selectedDate;
  const series=initial.parentId?data.events.find(e=>e.id===initial.parentId):undefined;
  const recurrence=initial.recurrence||series?.recurrence;
  const estimated=Number(initial.details?.estimatedMinutes||60);
  const startMinutes=timeToMinutes(initial.startTime||'09:00');
  const estimatedEnd=startMinutes+(Number.isFinite(estimated)?estimated:60);
  const defaultEnd=initial.endTime||`${String(Math.floor(estimatedEnd/60)%24).padStart(2,'0')}:${String(estimatedEnd%60).padStart(2,'0')}`;
  const form=useForm<FormValues>({resolver:zodResolver(formSchema),defaultValues:{title:initial.title||'',description:initial.description||'',category:initial.category||'personal',date:startDate,endDate:initial.endDate||(initial.endTime&&initial.startTime&&initial.endTime<=initial.startTime?shiftDate(startDate,1):!initial.endTime?shiftDate(startDate,Math.floor(estimatedEnd/1440)):startDate),startTime:initial.startTime||'09:00',endTime:defaultEnd,location:initial.location||'',notes:initial.notes||'',fixed:initial.fixed||false,repeat:!!recurrence,until:recurrence?.until||shiftDate(startDate,90),days:recurrence?.daysOfWeek||[new Date(startDate+'T12:00:00Z').getUTCDay()],reminder:initial.details?.reminderMinutes===null?'none':[5,10,15,30,60].includes(Number(initial.details?.reminderMinutes??10))?String(initial.details?.reminderMinutes??10):'custom',customReminder:Number(initial.details?.reminderMinutes??20),checklist:initial.checklist?.map(x=>x.text).join('\n')||'',instructor:String(initial.details?.instructor||'')}});
  const {register,watch,setValue,formState:{errors}}=form;const repeat=watch('repeat');const category=watch('category');
  const watchedDate=watch('date');const previousDate=useRef(startDate);
  useEffect(()=>{if(watchedDate&&watchedDate!==previousDate.current){const previous=previousDate.current;const previousEnd=form.getValues('endDate');const span=Math.max(0,Math.round((Date.parse(previousEnd+'T12:00:00Z')-Date.parse(previous+'T12:00:00Z'))/86400000));try{setValue('endDate',shiftDate(watchedDate,Number.isFinite(span)?span:0));}catch{}previousDate.current=watchedDate;}},[watchedDate,form,setValue]);
  const submit=(values:FormValues)=>{
    if(needsTimeReview){setNotice(tr("quick.ambiguous"));return;}
    if(values.repeat&&values.days.length===0){setNotice(tr("Choose at least one weekday for a repeating activity."));return;}
    const event:LifeEvent={id:request.event?.id||crypto.randomUUID(),title:values.title,description:values.description,category:values.category,date:values.date,endDate:values.endDate,startTime:values.startTime,endTime:values.endTime,location:values.location,notes:values.notes,fixed:values.fixed,status:request.event?.status||'planned',details:{...initial.details,reminderMinutes:values.reminder==='none'?null:values.reminder==='custom'?values.customReminder:Number(values.reminder),instructor:values.instructor||undefined},checklist:[...new Set(values.checklist.split('\n').map(x=>x.trim()).filter(Boolean))].map(text=>{const existing=initial.checklist?.find(x=>x.text===text);return existing||{id:crypto.randomUUID(),text:text.trim(),done:false};}),...(values.repeat&&(!series||scope==='series')?{recurrence:{frequency:'weekly' as const,daysOfWeek:values.days,until:values.until}}:{}),...(initial.parentId?{parentId:initial.parentId}:{})};
    const parsed=lifeEventSchema.safeParse(event);if(!parsed.success){setNotice(issue(parsed.error.issues[0]));return;}
    try{const {start,end}=eventInstants(event,data.preferences.timezone);if(end.getTime()-start.getTime()>7*86400000){setNotice(tr("Keep a single activity within seven days."));return;}if(event.recurrence&&values.until>shiftDate(values.date,730)){setNotice(tr("Repeat for up to two years, then extend the series when needed."));return;}
      if(series&&scope==='series'&&values.date!==initial.date){setNotice(tr("For a series, keep the occurrence date and choose the weekdays below. Move a single occurrence by choosing Only this occurrence."));return;}
      const prospective=saveOccurrence(data.events,request.event,event,scope);const days=[event.date,event.endDate||event.date,...(event.recurrence?Array.from({length:Math.min(731,Math.ceil((Date.parse(event.recurrence.until)-Date.parse(event.date))/86400000)+1)},(_,i)=>shiftDate(event.date,i)):[])];
      const conflicts=[...new Set(days.flatMap(day=>findConflicts(eventsForDate(prospective,day,data.preferences.timezone),data.preferences.timezone).filter(pair=>pair.first.id===event.id||pair.second.id===event.id||pair.first.parentId===event.id||pair.second.parentId===event.id||pair.first.title===event.title||pair.second.title===event.title).map(pair=>tr("{p0}: {p1} overlaps {p2}", {p0: day, p1: pair.first.title, p2: pair.second.title}))))];
      if(conflicts.length&&(!approved||JSON.stringify(conflicts)!==JSON.stringify(overlaps))){setOverlaps(conflicts);setApproved(true);return;}
      onSave(parsed.data,request.event,scope);onClose();
    }catch{setNotice(tr("Please check the start and end dates and your timezone."));}
  };
  return <Dialog open onOpenChange={open=>!open&&onClose()}><DialogContent className="event-editor"><div className="modal-heading"><span className="modal-icon"><CalendarDays size={21}/></span><DialogTitle>{request.event?tr("Edit activity"):tr("Make time for something")}</DialogTitle><DialogDescription>{tr("A little intention goes a long way.")}</DialogDescription></div>
    <form onSubmit={form.handleSubmit(submit)} onChange={()=>{setApproved(false);setOverlaps([]);setNotice('');if(form.getValues('startTime')&&form.getValues('endTime'))setNeedsTimeReview(false);}}>
      {!request.event&&<div className="quick-parse"><label className="label" htmlFor="quick-input"><Sparkles size={14}/> {tr("Add in your own words")}</label><div className="input-action"><input id="quick-input" className="field" value={quick} onChange={e=>setQuick(e.target.value)} placeholder={tr("Tomorrow at 16h gym for 90 minutes")}/><Button type="button" variant="secondary" onClick={()=>{const result=parseQuickEntry(quick,selectedDate);const parsed=result.draft;previousDate.current=parsed.date;Object.entries(parsed).forEach(([k,v])=>setValue(k as keyof FormValues,v as never));setValue('endDate',parsed.endDate||parsed.date);setNeedsTimeReview(result.needsClarification);if(result.needsClarification){setValue('startTime','');setValue('endTime','');}setNotice(result.ambiguousHour?tr('quick.ambiguousHour',{hour:result.ambiguousHour,afternoon:result.ambiguousHour%12+12}):tr(result.needsClarification?'quick.incomplete':'quick.review'));}}>{tr("Fill form")}</Button></div><small className="muted">{tr("Quick parsing fills a draft. You always review the exact time.")}</small></div>}
      <label className="label">{tr("Activity name")}<input className="field title-input" placeholder={tr("What would you like to do?")} {...register('title')}/></label>{errors.title&&<p className="form-error">{issue(errors.title)}</p>}{errors.customReminder&&<p className="form-error">{tr("Choose reminder minutes between 0 and 1440.")}</p>}
      <div className="label">{tr("Category")}<div className="category-selector" role="group" aria-label={tr("Activity category")}>{categories.map(cat=><button type="button" key={cat} className={`category-chip category-${cat} ${category===cat?'selected':''}`} onClick={()=>setValue('category',cat)}>{humanCategory(cat)}</button>)}</div></div>
      <div className="form-grid"><label className="label">{tr("Start date")}<input className="field" type="date" {...register('date')}/></label><label className="label">{tr("End date")}<input className="field" type="date" min={watch('date')} {...register('endDate')}/></label><label className="label"><Clock3 size={13}/> {tr("Starts at")}<input className="field" type="time" {...register('startTime')}/></label><label className="label">{tr("Ends at")}<input className="field" type="time" {...register('endTime')}/></label></div>
      <label className="label">{tr("Description")}<textarea className="field" rows={2} placeholder={tr("The details that matter…")} {...register('description')}/></label>
      <div className="form-grid"><label className="label"><MapPin size={13}/> {tr("Location")}<input className="field" placeholder={tr("Room, gym, or a link")} {...register('location')}/></label><label className="label">{tr("Reminder")}<select className="field" {...register('reminder')}><option value="none">{tr("No reminder")}</option><option value="5">{tr("5 minutes before")}</option><option value="10">{tr("10 minutes before")}</option><option value="15">{tr("15 minutes before")}</option><option value="30">{tr("30 minutes before")}</option><option value="60">{tr("1 hour before")}</option><option value="custom">{tr("Custom (set minutes below)")}</option></select></label></div>
      {watch('reminder')==='custom'&&<label className="label">{tr("Minutes before")}<input className="field" type="number" min="0" max="1440" {...register('customReminder',{valueAsNumber:true})}/></label>}
      {category==='study'&&<label className="label">{tr("Lecturer / instructor")}<input className="field" {...register('instructor')} placeholder={tr("Optional")}/></label>}
      <div className="form-options"><label><input type="checkbox" {...register('fixed')}/> {tr("Fixed time")} <small className="muted">{tr("AI keeps this in place")}</small></label>{(!series||scope==='series')&&<label><input type="checkbox" {...register('repeat')}/><Repeat2 size={14}/> {tr("Repeat weekly")}</label>}</div>
      {repeat&&(!series||scope==='series')&&<div className="repeat-options"><div className="weekday-buttons">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><button aria-label={tr(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i])} key={i} type="button" className={watch('days').includes(i)?'selected':''} onClick={()=>setValue('days',watch('days').includes(i)?watch('days').filter(d=>d!==i):[...watch('days'),i])}>{tr(day)}</button>)}</div><label className="label">{tr("Repeat until")}<input className="field" type="date" min={watch('date')} {...register('until')}/></label>{errors.days&&<p className="form-error">{issue(errors.days)}</p>}</div>}
      {request.event?.parentId&&request.event.id.includes('::')&&<label className="label">{tr("Apply changes to")}<select className="field" value={scope} onChange={e=>{setScope(e.target.value as 'one'|'series');setApproved(false);setOverlaps([]);}} ><option value="one">{tr("Only this occurrence")}</option><option value="series">{tr("The entire recurring series")}</option></select></label>}
      <details className="advanced-options"><summary>{tr("Checklist & notes")}</summary><label className="label">{tr("Checklist")} <small className="muted">{tr("One item per line")}</small><textarea className="field" rows={3} {...register('checklist')}/></label><label className="label">{tr("Notes")}<textarea className="field" rows={3} {...register('notes')}/></label></details>
      {Object.entries(errors).filter(([key])=>!['title','days','customReminder'].includes(key)).map(([key,error])=><p key={key} className="form-error" role="alert">{issue({type:String(error.type||''),message:String(error.message||'')})}</p>)}{notice&&<p className="form-notice" role="status">{localizeMessage(notice,true)}</p>}{overlaps.length>0&&<div className="conflict-warning" role="alert"><AlertTriangle size={17}/><div><strong>{tr("These times overlap")}</strong>{overlaps.slice(0,4).map(x=><p key={x}>{localizeMessage(x)}</p>)}<p>{tr("You can adjust the time or save the overlap intentionally.")}</p></div></div>}
      <div className="modal-footer"><Button type="button" variant="ghost" onClick={onClose}>{tr("Cancel")}</Button><Button type="submit"><Check size={16}/>{approved?tr("Save with overlap"):request.event?tr("Save changes"):tr("Add activity")}</Button></div>
    </form></DialogContent></Dialog>;
}
