import {describe,expect,it} from 'vitest';
import {dictionaries,enumLabel,eventTimeRange,formatCalendarDay,formatDay,formatDurationFor,formatTimeFor,localizeMessage,relativeDay,translate,validationMessage} from '../src/i18n/core';
import {ambiguousSpokenTime,hasNaturalDate,parseQuickEntry} from '../src/lib/quick-add';
import {emptyData} from '../src/lib/types';
import {createDemoData} from '../src/lib/demo';

describe('complete Vietnamese resources and formatting',()=>{
  it('defaults new workspaces to Vietnamese and keeps resource keys/interpolations in parity',()=>{
    expect(emptyData().preferences.language).toBe('vi');expect(Object.keys(dictionaries.vi).sort()).toEqual(Object.keys(dictionaries.en).sort());
    for(const key of Object.keys(dictionaries.en)){expect(dictionaries.vi[key].trim(),key).not.toBe('');expect([...dictionaries.vi[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key).toEqual([...dictionaries.en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());}
  });
  it('interpolates names/counts and falls back without throwing',()=>{expect(translate('vi','greeting.morning',{name:'Hiếu'})).toBe('Chào buổi sáng, Hiếu ☀️');expect(translate('vi','dashboard.summary',{activities:6,tasks:2})).toContain('6 hoạt động và 2 công việc');expect(translate('vi','a.future.key')).toBe('a.future.key');});
  it('uses English fallback and treats prototype-shaped missing keys as ordinary keys',()=>{const value=dictionaries.vi.Cancel;delete dictionaries.vi.Cancel;try{expect(translate('vi','Cancel')).toBe('Cancel');expect(translate('vi','constructor')).toBe('constructor');}finally{dictionaries.vi.Cancel=value;}});
  it('formats calendar dates/durations without modifying any saved event fields',()=>{
    const data=createDemoData('2026-10-26','en');const snapshot=JSON.stringify(data);
    expect(formatDay('vi','2026-10-26','EEEE, MMMM d, yyyy')).toBe('Thứ Hai, ngày 26 tháng 10 năm 2026');
    expect(formatCalendarDay('vi','2026-10-26',{weekday:'long'})).toBe('Thứ Hai');
    expect(formatDurationFor('vi',150)).toBe('2 giờ 30 phút');expect(formatDurationFor('en',150)).toBe('2h 30m');
    expect(eventTimeRange('vi',data.events[1],'24')).toBe('07:00 – 09:30');expect(formatTimeFor('vi','16:00','12')).toBe('4:00 chiều');
    expect(relativeDay('vi','2026-10-27','2026-10-26')).toBe('Ngày mai');expect(relativeDay('vi','2026-10-25','2026-10-26')).toBe('Hôm qua');expect(JSON.stringify(data)).toBe(snapshot);
  });
  it('localizes dynamic constraint errors and Zod validation',()=>{expect(localizeMessage('vi','“Java” overlaps “Gym”.')).toBe('“Java” trùng giờ với “Gym”.');expect(validationMessage('vi',{code:'too_small',origin:'string',minimum:3})).toContain('ít nhất 3 ký tự');expect(localizeMessage('vi','Invalid login credentials',true)).toContain('mật khẩu');expect(localizeMessage('vi','Unexpected server failure',true)).not.toContain('Unexpected');});
  it('translates enum labels without translating stored enum values',()=>{const data=emptyData();expect(enumLabel('vi','study')).toBe('Học tập');expect(enumLabel('vi','completed')).toBe('Đã hoàn thành');expect(enumLabel('vi','Push')).toContain('Đẩy');expect(data.preferences.experience).toBe('Beginner');});
  it('generates separate localized demo data only when explicitly requested',()=>{const vi=createDemoData('2026-10-26','vi'),en=createDemoData('2026-10-26','en');expect(vi.events[1].title).toBe('Lập trình Java');expect(en.events[1].title).toBe('Java programming');expect(vi.events.map(e=>[e.id,e.category,e.status,e.date,e.startTime])).toEqual(en.events.map(e=>[e.id,e.category,e.status,e.date,e.startTime]));});
});

describe('Vietnamese natural schedule drafts',()=>{
  it.each([
    ['Mai 7h học Java','2026-10-27','07:00','08:00'],
    ['Mốt 7h30 học Java','2026-10-28','07:30','08:30'],
    ['Chiều nay 4 giờ tập chân','2026-10-26','16:00','17:00'],
    ['4 giờ chiều tập gym','2026-10-26','16:00','17:00'],
    ['Tối thứ Sáu 7h tập gym','2026-10-30','19:00','20:00'],
    ['Mai 16h tập gym 90 phút','2026-10-27','16:00','17:30'],
    ['Mai học từ 7h đến 11h30','2026-10-27','07:00','11:30'],
    ['Tomorrow at 16h gym for 90 minutes','2026-10-27','16:00','17:30'],
  ])('%s', (text,date,startTime,endTime)=>{expect(parseQuickEntry(text,'2026-10-26')).toMatchObject({needsClarification:false,draft:{date,startTime,endTime}});});
  it('never invents an ambiguous spoken time or a missing hour',()=>{const result=parseQuickEntry('Mai 4 giờ tập gym','2026-10-26');expect(result.needsClarification).toBe(true);expect(result.ambiguousHour).toBe(4);expect(result.draft.startTime).toBeUndefined();expect(parseQuickEntry('Chiều nay tập gym','2026-10-26').needsClarification).toBe(true);expect(ambiguousSpokenTime('Mai 4 giờ tập gym')).toBe(4);expect(ambiguousSpokenTime('Mai 4 giờ chiều tập gym')).toBeUndefined();});
  it('does not interpret the Vietnamese number một as mốt',()=>{expect(hasNaturalDate('Học một giờ')).toBe(false);expect(parseQuickEntry('Học một giờ','2026-10-26').draft.date).toBe('2026-10-26');});
});
