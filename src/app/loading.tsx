"use client";
import {useI18n} from "@/i18n/provider";
export default function Loading(){
  const {t:tr,message:localizeMessage,issue,language}=useI18n();
return <main className="error-page" aria-busy="true"><div className="brand-mark">L</div><p>{tr("Making room for your day…")}</p></main>;}
