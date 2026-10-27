"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import {DEFAULT_LANGUAGE,LANGUAGE_COOKIE,LANGUAGE_STORAGE,enumLabel,eventTimeRange,formatCalendarDay,formatDay,formatDurationFor,formatTimeFor,languageOf,localizeMessage,relativeDay,translate,validationMessage,type Language,type MessageValues} from './core';

const LocaleContext=createContext<{language:Language;setLanguage:(language:Language)=>void}>({language:DEFAULT_LANGUAGE,setLanguage:()=>{}});
export function LocaleProvider({children,initialLanguage=DEFAULT_LANGUAGE}:{children:React.ReactNode;initialLanguage?:Language}){
  const [language,setLocale]=useState<Language>(initialLanguage);
  const setLanguage=useCallback((next:Language)=>{setLocale(next);try{localStorage.setItem(LANGUAGE_STORAGE,next);}catch{}document.cookie=`${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;document.documentElement.lang=next;},[]);
  useEffect(()=>{try{const stored=localStorage.getItem(LANGUAGE_STORAGE);if(stored==='en'||stored==='vi')setLanguage(stored);}catch{}},[setLanguage]);
  useEffect(()=>{document.documentElement.lang=language;document.title=translate(language,'app.title');const description=document.querySelector('meta[name="description"]');description?.setAttribute('content',translate(language,'app.description'));},[language]);
  useEffect(()=>{
    const invalid=(event:Event)=>{
      const input=event.target;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement))return;
      const validity=input.validity;let key='validation.invalid';let values:MessageValues={};
      if(validity.valueMissing)key='validation.required';
      else if(validity.typeMismatch&&input instanceof HTMLInputElement&&input.type==='email')key='validation.invalidEmail';
      else if(validity.tooShort){key='validation.tooShort';values={minimum:(input as HTMLInputElement).minLength};}
      else if(validity.tooLong){key='validation.tooLong';values={maximum:(input as HTMLInputElement).maxLength};}
      else if(validity.rangeUnderflow){key='validation.tooSmall';values={minimum:Number((input as HTMLInputElement).min)};}
      else if(validity.rangeOverflow){key='validation.tooBig';values={maximum:Number((input as HTMLInputElement).max)};}
      input.setCustomValidity(translate(language,key,values));
    };
    const clear=(event:Event)=>{const input=event.target;if(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement)input.setCustomValidity('');};
    document.addEventListener('invalid',invalid,true);document.addEventListener('input',clear,true);document.addEventListener('change',clear,true);
    return()=>{document.removeEventListener('invalid',invalid,true);document.removeEventListener('input',clear,true);document.removeEventListener('change',clear,true);};
  },[language]);
  return <LocaleContext.Provider value={useMemo(()=>({language,setLanguage}),[language,setLanguage])}>{children}</LocaleContext.Provider>;
}
export function useI18n(){const {language,setLanguage}=useContext(LocaleContext);return useMemo(()=>({
  language,setLanguage,t:(key:string,values?:MessageValues)=>translate(language,key,values),message:(value:string,unknownError=false)=>localizeMessage(language,value,unknownError),issue:(value:Parameters<typeof validationMessage>[1])=>validationMessage(language,value),
  formatDuration:(minutes:number)=>formatDurationFor(language,minutes),formatTime:(time:string,mode:'12'|'24'='24')=>formatTimeFor(language,time,mode),dayLabel:(day:string,pattern?:string)=>formatDay(language,day,pattern),calendarDayLabel:(day:string,options?:Intl.DateTimeFormatOptions)=>formatCalendarDay(language,day,options),humanCategory:(value:string)=>enumLabel(language,value),timeRange:(event:Parameters<typeof eventTimeRange>[1],mode:'12'|'24')=>eventTimeRange(language,event,mode),relativeDay:(day:string,today:string)=>relativeDay(language,day,today),
}),[language,setLanguage]);}
