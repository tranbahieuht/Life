import type {Category} from './types';
import {isValidDateKey,minutesToTime,shiftDate} from './schedule';

export interface QuickDraft {title:string;category:Category;date:string;endDate?:string;startTime?:string;endTime?:string}
export interface QuickEntry {draft:QuickDraft;needsClarification:boolean;ambiguousHour?:number}
export function normalizeVietnamese(value:string):string{return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
export function hasNaturalDate(text:string):boolean{return /\bmốt\b/i.test(text)||/\b(mai|hom nay|hom qua|today|tomorrow|yesterday|thu (hai|ba|tu|nam|sau|bay|[2-7])|chu nhat|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(normalizeVietnamese(text));}

/** A draft parser only. Missing/ambiguous times remain unset and must be reviewed. */
export function parseQuickEntry(text:string,referenceDate:string):QuickEntry{
  if(!isValidDateKey(referenceDate))throw new Error('Choose a valid date.');
  const input=normalizeVietnamese(text);let date=referenceDate;
  if(/\bmốt\b/i.test(text)||/\bday after tomorrow\b/.test(input))date=shiftDate(date,2);
  else if(/\b(mai|tomorrow)\b/.test(input))date=shiftDate(date,1);
  else if(/\b(hom qua|yesterday)\b/.test(input))date=shiftDate(date,-1);
  const weekdays:[RegExp,number][]=[[/\b(chu nhat|sunday)\b/,0],[/\b(thu hai|thu 2|monday)\b/,1],[/\b(thu ba|thu 3|tuesday)\b/,2],[/\b(thu tu|thu 4|wednesday)\b/,3],[/\b(thu nam|thu 5|thursday)\b/,4],[/\b(thu sau|thu 6|friday)\b/,5],[/\b(thu bay|thu 7|saturday)\b/,6]];
  const weekday=weekdays.find(([pattern])=>pattern.test(input));
  if(weekday){const current=new Date(`${referenceDate}T12:00:00Z`).getUTCDay();let offset=(weekday[1]-current+7)%7;if(/\b(tuan sau|next)\b/.test(input))offset=offset===0?7:offset+7;date=shiftDate(referenceDate,offset);}
  const explicit=input.match(/\b([01]?\d|2[0-3])\s*(h|:)([0-5]\d)?\b/)||input.match(/\b(\d{1,2})\s*(gio|o'clock)\s*(\d{1,2})?\b/)||input.match(/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/);
  const category:Category=/gym|workout|tap|pull|push|chan|cau long/.test(input)?'workout':/class|study|hoc|java/.test(input)?'study':/lunch|dinner|meal|an |com|pho|banh mi/.test(input)?'nutrition':/project|work|lam/.test(input)?'work':'personal';
  const draft:QuickDraft={title:text.trim(),category,date};
  const hasMorning=/\b(sang|morning|am)\b/.test(input);const hasAfternoon=/\b(chieu|afternoon|pm)\b/.test(input);const hasEvening=/\b(toi|evening|night)\b/.test(input);const hasNoon=/\b(trua|noon)\b/.test(input);
  if(!explicit)return {draft,needsClarification:true};
  let hour=Number(explicit[1]);const unit=explicit[2];let minute=Number(explicit[3]||0);
  if(hour>23||minute>59)return {draft,needsClarification:true};
  if(unit==='gio'&&hour>=1&&hour<=12&&!hasMorning&&!hasAfternoon&&!hasEvening&&!hasNoon)return {draft,needsClarification:true,ambiguousHour:hour};
  if((hasAfternoon||hasEvening||unit==='pm')&&hour<12)hour+=12;
  if((hasMorning||unit==='am')&&hour===12)hour=0;
  if(hasNoon&&hour<11)return {draft,needsClarification:true,ambiguousHour:hour};
  // Multiple clock times may describe a range. Respect a clear end instead of inventing duration.
  const range=input.match(/\b(?:den|toi|to|until|–|-)\s*(\d{1,2})\s*(h|:|gio)\s*([0-5]\d)?\b/);
  const duration=input.match(/\b(?:trong\s+|for\s+)?(\d+(?:[.,]\d+)?)\s*(tieng|hours?|phut|minutes?|mins?)\b/);
  const start=hour*60+minute;let end=start+60;
  if(range){let endHour=Number(range[1]);if((hasAfternoon||hasEvening)&&endHour<12)endHour+=12;end=endHour*60+Number(range[3]||0);if(end<=start)end+=1440;}
  else if(duration){end=start+Math.round(Number(duration[1].replace(',','.'))*(/tieng|hour/.test(duration[2])?60:1));}
  if(end-start<=0||end-start>7*1440)return {draft,needsClarification:true};
  draft.startTime=minutesToTime(start);draft.endTime=minutesToTime(end);draft.endDate=shiftDate(date,Math.floor(end/1440));
  return {draft,needsClarification:false};
}

/** Detect ambiguous spoken clock times for a clarification response before invoking Gemini. */
export function ambiguousSpokenTime(prompt:string):number|undefined{
  const input=normalizeVietnamese(prompt);const matches=[...input.matchAll(/\b(\d{1,2})\s+gio\b/g)];
  for(const match of matches){const hour=Number(match[1]);if(hour<1||hour>12)continue;const nearby=input.slice(Math.max(0,match.index!-18),match.index!+match[0].length+22);if(!/\b(sang|trua|chieu|toi|dem|am|pm|trong|keo dai|mat|khoang|lam project|hoc tieng anh)\b/.test(nearby))return hour;}
  return undefined;
}
