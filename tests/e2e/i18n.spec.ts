import {test,expect,type Page} from '@playwright/test';
import {createDemoData} from '../../src/lib/demo';
import {emptyData} from '../../src/lib/types';
test.use({locale:'vi-VN'});

async function openVi(page:Page){await page.goto('/');await expect(page.getByRole('heading',{name:'Lịch trình hôm nay',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','vi');}
async function navigate(page:Page,label:string){if(label==='Cài đặt'){if(await page.locator('.mobile-nav').isVisible()){await page.getByRole('button',{name:'Mở hồ sơ'}).click();await page.getByRole('button',{name:'Cài đặt cá nhân'}).click();}else await page.locator('.sidebar-bottom').getByRole('button',{name:label,exact:true}).click();return;}if(label==='Ăn uống'&&await page.locator('.mobile-nav').isVisible()){await page.goto('/?view=nutrition');return;}await page.locator(await page.locator('.mobile-nav').isVisible()?'.mobile-nav':'.sidebar nav').getByRole('button',{name:label,exact:true}).click();}

test('Vietnamese is the fresh default, including date, greeting, form and native validation',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00+07:00')});await openVi(page);await expect(page.locator('.greeting-date')).toHaveText('Thứ Hai, ngày 26 tháng 10 năm 2026');await expect(page.locator('h1')).toContainText('Chào buổi sáng');
  await page.getByRole('button',{name:'Thêm nhanh',exact:true}).click();const form=page.getByRole('dialog');await expect(form.getByLabel('Tên hoạt động')).toBeVisible();await expect(form.getByLabel('Giờ bắt đầu')).toBeVisible();await form.getByRole('button',{name:'Thêm hoạt động',exact:true}).click();await expect(form.getByRole('paragraph').filter({hasText:'Hãy đặt tên cho hoạt động.'})).toBeVisible();await expect(form).not.toContainText('Give your activity');
});

test('switch vi to en and back, reload, and preserve every event, task and preference value',async({page})=>{
  const data=createDemoData('2026-10-26','vi');data.preferences.displayName='Hiếu';
  await page.clock.install({time:new Date('2026-10-26T08:00:00+07:00')});await page.addInitScript(data=>{if(!localStorage.getItem('life-os:local:v1'))localStorage.setItem('life-os:local:v1',JSON.stringify(data));},data);await openVi(page);
  const before=await page.evaluate(()=>{const cached=JSON.parse(localStorage.getItem('life-os:local:v1')!);const data=cached.data||cached;return JSON.stringify({events:data.events,tasks:data.tasks,plans:data.workoutPlans,meals:data.mealTemplates,logs:data.exerciseLogs});});
  await navigate(page,'Cài đặt');await page.getByLabel('Ngôn ngữ',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Lưu cài đặt'}).click();await expect(page.getByRole('heading',{name:'A rhythm that fits you.'})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','en');await page.reload();await expect(page.getByRole('heading',{name:'A rhythm that fits you.'})).toBeVisible();await page.getByLabel('Language',{exact:true}).selectOption('vi');await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.getByRole('heading',{name:'Cài đặt phù hợp với bạn.'})).toBeVisible();await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','vi');
  const after=await page.evaluate(()=>{const cached=JSON.parse(localStorage.getItem('life-os:local:v1')!);const data=cached.data||cached;return JSON.stringify({events:data.events,tasks:data.tasks,plans:data.workoutPlans,meals:data.mealTemplates,logs:data.exerciseLogs});});expect(JSON.parse(after)).toEqual(JSON.parse(before));
});

test('ambiguous Vietnamese quick entry requires exact times and never saves a guess',async({page})=>{
  await openVi(page);await page.getByRole('button',{name:'Thêm nhanh',exact:true}).click();const form=page.getByRole('dialog');await form.getByLabel('Nhập lịch theo cách của bạn').fill('Mai 4 giờ tập gym');await form.getByRole('button',{name:'Điền vào biểu mẫu'}).click();await expect(form.getByRole('status')).toContainText('4 giờ sáng hay 16 giờ');await expect(form.getByLabel('Giờ bắt đầu')).toHaveValue('');await form.getByRole('button',{name:'Thêm hoạt động',exact:true}).click();expect(await page.locator('.activity-block').count()).toBe(0);await form.getByLabel('Giờ bắt đầu').fill('16:00');await form.getByLabel('Giờ kết thúc').fill('17:00');await form.getByRole('button',{name:'Thêm hoạt động',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('AI clarification in Vietnamese never creates an activity',async({page})=>{
  await page.route('**/api/config',route=>route.fulfill({json:{supabaseConfigured:false,aiConfigured:true}}));let language='';await page.route('**/api/plan',route=>{language=route.request().postDataJSON().preferences.language;return route.fulfill({json:{clarification:'Bạn muốn 4 giờ sáng hay 16 giờ chiều?'}});});await openVi(page);await navigate(page,'Trợ lý AI');await page.getByRole('textbox',{name:'Bạn muốn sắp xếp lịch thế nào?'}).fill('Mai 4 giờ tập gym');await page.getByRole('button',{name:'Tạo kế hoạch',exact:true}).click();await expect(page.locator('.ai-clarification')).toContainText('4 giờ sáng hay 16 giờ chiều');expect(language).toBe('vi');await expect(page.getByRole('button',{name:'Chấp nhận kế hoạch'})).toHaveCount(0);
});

for(const width of [375,390,768,1024,1440])test(`Vietnamese modules and dialogs fit at ${width}px`,async({page},testInfo)=>{
  await page.clock.install({time:new Date('2026-10-26T08:00:00+07:00')});await page.setViewportSize({width,height:900});const data=createDemoData('2026-10-26','vi');await page.addInitScript(data=>{localStorage.setItem('life-os:local:v1',JSON.stringify(data));},data);await openVi(page);
  for(const label of ['Hôm nay','Lịch','Công việc','Ăn uống','Tập luyện','Trợ lý AI','Cài đặt']){
    if(label!=='Hôm nay')await navigate(page,label);
    await expect(page.locator('main h1')).toHaveCount(1);await expect(page.locator('html')).toHaveAttribute('lang','vi');expect(await page.evaluate(()=>document.documentElement.scrollWidth),label).toBeLessThanOrEqual(width);
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({animations:'disabled',path:testInfo.outputPath(`vi-${width}-${label}.png`)});
    const englishLeak=await page.locator('main').innerText();expect(englishLeak).not.toMatch(/\b(Upcoming|Completed|Unconfirmed|Your timeline|Your workspace|Make space|Schedule a session|A little|Save preferences|Fixed time|Create my plan|No meals planned)\b/);
    if(label==='Lịch'){await page.getByRole('button',{name:'Tháng',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
  }
  await page.getByRole('button',{name:'Thêm nhanh',exact:true}).click();const form=page.getByRole('dialog');await expect(form.getByLabel('Tên hoạt động')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({animations:'disabled',path:testInfo.outputPath(`vi-dialog-${width}.png`)});
});
