import en from './messages/en.json';
import vi from './messages/vi.json';
import {format} from 'date-fns';
import {enUS,vi as viLocale} from 'date-fns/locale';
import {shiftDate} from '@/lib/schedule';
import type {LifeEvent} from '@/lib/types';

export type Language='vi'|'en';
export type MessageValues=Record<string,string|number>;
export const DEFAULT_LANGUAGE:Language='vi';
export const LANGUAGE_COOKIE='life-os-language';
export const LANGUAGE_STORAGE='life-os:language';
export const dictionaries:Record<Language,Record<string,string>>={en,vi};
export function languageOf(value:unknown):Language{return value==='en'?'en':'vi';}
export function translate(language:Language,key:string,values:MessageValues={}):string{
  const own=(messages:Record<string,string>)=>Object.hasOwn(messages,key)?messages[key]:undefined;
  const template=own(dictionaries[language])??own(dictionaries.en)??key;
  return template.replace(/\{(\w+)\}/g,(match,name)=>!Object.hasOwn(values,name)||values[name]===undefined?match:String(values[name]));
}
const patternMessages=Object.keys(en).filter(key=>/\{p\d+\}/.test(key)).map(key=>{
  const names:string[]=[];const source=key.split(/(\{p\d+\})/).map(part=>{const name=part.match(/^\{(p\d+)\}$/)?.[1];if(name){names.push(name);return '(.+?)';}return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');return {key,names,regex:new RegExp(`^${source}$`)};
});
/** Localize only app-generated messages. Never pass user titles/notes through this function. */
export function localizeMessage(language:Language,message:string,unknownError=false):string{
  if(!message)return '';
  if(dictionaries[language][message]!==undefined)return translate(language,message);
  for(const pattern of patternMessages){const match=message.match(pattern.regex);if(match)return translate(language,pattern.key,Object.fromEntries(pattern.names.map((name,i)=>[name,localizeMessage(language,match[i+1])])));}
  if(/invalid login credentials/i.test(message))return translate(language,'error.invalidCredentials');
  if(/email not confirmed/i.test(message))return translate(language,'error.emailNotConfirmed');
  if(/already registered|already been registered/i.test(message))return translate(language,'error.alreadyRegistered');
  if(/rate.limit|too many requests|security purposes.*seconds/i.test(message))return translate(language,'error.rateLimit');
  if(/fetch failed|failed to fetch|networkerror|network request/i.test(message))return translate(language,'error.network');
  if(unknownError&&language==='vi'&&/[a-zA-Z]{3}/.test(message)&&!/[\u00c0-\u1ef9]/.test(message))return translate(language,'error.generic');
  return message;
}
export function validationMessage(language:Language,issue:{code?:string;type?:string;message?:string;minimum?:number|bigint;maximum?:number|bigint;origin?:string;expected?:string;format?:string}):string{
  if(issue.message&&(dictionaries.en[issue.message]||patternMessages.some(p=>p.regex.test(issue.message!))))return localizeMessage(language,issue.message);
  const code=issue.code||issue.type;const boundary=issue.message?.match(/[<>]=?(\d+)/)?.[1];const isString=issue.origin==='string'||/string|characters/.test(issue.message||'');
  if(code==='too_small')return translate(language,isString?'validation.tooShort':'validation.tooSmall',{minimum:Number(issue.minimum??boundary??1)});
  if(code==='too_big')return translate(language,isString?'validation.tooLong':'validation.tooBig',{maximum:Number(issue.maximum??boundary??0)});
  if(issue.format==='email')return translate(language,'validation.invalidEmail');
  if(issue.code==='invalid_type'&&issue.expected==='string')return translate(language,'validation.required');
  return localizeMessage(language,issue.message||'',true)||translate(language,'validation.invalid');
}
export function formatDurationFor(language:Language,minutes:number):string{const rounded=Math.max(0,Math.round(minutes));const hours=Math.floor(rounded/60);const rest=rounded%60;return translate(language,hours&&rest?'duration.both':hours?'duration.hours':'duration.minutes',{hours,minutes:rest});}
export function formatTimeFor(language:Language,time:string,mode:'12'|'24'='24'):string{
  if(mode==='24')return time;const [hour,minute]=time.split(':').map(Number);return `${hour%12||12}:${String(minute).padStart(2,'0')}${translate(language,hour<12?'time.morning':hour===12?'time.noon':hour<18?'time.afternoon':'time.evening')}`;
}
export function formatDay(language:Language,day:string,pattern='EEEE, MMMM d'):string{
  const [y,m,d]=day.split('-').map(Number);const date=new Date(y,m-1,d,12);
  const patterns:Record<string,string>={'EEEE, MMMM d, yyyy':"EEEE, 'ngày' d 'tháng' M 'năm' yyyy",'EEEE, MMMM d':"EEEE, 'ngày' d 'tháng' M",'MMMM yyyy':"'Tháng' M 'năm' yyyy",'MMM d':'dd/MM'};
  const result=format(date,language==='vi'?(patterns[pattern]||pattern):pattern,{locale:language==='vi'?viLocale:enUS});return result.charAt(0).toUpperCase()+result.slice(1);
}
export function formatCalendarDay(language:Language,day:string,options?:Intl.DateTimeFormatOptions):string{return new Intl.DateTimeFormat(language==='vi'?'vi-VN':'en-US',{...(options??{weekday:'short',month:'short',day:'numeric'}),timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));}
export function relativeDay(language:Language,day:string,today:string):string{return day===today?translate(language,'Today.relative'):day===shiftDate(today,1)?translate(language,'Tomorrow.relative'):day===shiftDate(today,-1)?translate(language,'Yesterday.relative'):formatDay(language,day,'MMM d');}
export function eventTimeRange(language:Language,event:LifeEvent,mode:'12'|'24'):string{const days=event.endDate?Math.max(0,Math.round((Date.parse(`${event.endDate}T12:00:00Z`)-Date.parse(`${event.date}T12:00:00Z`))/86400000)):event.endTime<=event.startTime?1:0;return `${formatTimeFor(language,event.startTime,mode)} – ${formatTimeFor(language,event.endTime,mode)}${days?` ${translate(language,'duration.days',{days})}`:''}`;}
export function enumLabel(language:Language,value:string):string{const title=value.charAt(0).toUpperCase()+value.slice(1);return translate(language,title);}
export function requestLanguage(request:Request):Language{const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)life-os-language=(vi|en)(?:;|$)/)?.[1];return languageOf(cookie||request.headers.get('accept-language')?.split(',')[0]?.split('-')[0]);}
