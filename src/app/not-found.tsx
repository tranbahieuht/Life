"use client";
import Link from 'next/link';
import {useI18n} from '@/i18n/provider';
export default function NotFound(){const {t}=useI18n();return <main className="error-page"><h1>{t('notFound.title')}</h1><p>{t('notFound.description')}</p><Link className="btn btn-primary" href="/">{t('notFound.home')}</Link></main>;}
