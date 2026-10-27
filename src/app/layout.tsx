import type { Metadata, Viewport } from "next";
import "./globals.css";
import {cookies} from 'next/headers';
import {LocaleProvider} from '@/i18n/provider';
import {LANGUAGE_COOKIE,languageOf,translate} from '@/i18n/core';
export async function generateMetadata():Promise<Metadata>{const language=languageOf((await cookies()).get(LANGUAGE_COOKIE)?.value);return {title:translate(language,'app.title'),description:translate(language,'app.description'),applicationName:'LIFE OS'};}
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#F7F8FA"};
export default async function RootLayout({children}:{children:React.ReactNode}) {const language=languageOf((await cookies()).get(LANGUAGE_COOKIE)?.value);return <html lang={language} suppressHydrationWarning><body><LocaleProvider initialLanguage={language}>{children}</LocaleProvider></body></html>;}
