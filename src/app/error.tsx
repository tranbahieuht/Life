"use client";
import {useI18n} from "@/i18n/provider";
export default function Error({reset}:{error:Error;reset:()=>void}){
  const {t:tr,message:localizeMessage,issue,language}=useI18n();
return <main className="error-page"><h1>{tr("Let’s get you back on track.")}</h1><p>{tr("Something interrupted this view. Your saved activities are still here.")}</p><button className="btn btn-primary" onClick={reset}>{tr("Try again")}</button></main>;}
