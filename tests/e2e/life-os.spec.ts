import {test,expect,type Page} from '@playwright/test';
import {emptyData} from '../../src/lib/types';

// Preserve the original acceptance suite as explicit English-language coverage.
test.beforeEach(async({page,context})=>{const data=emptyData();data.preferences.language='en';await context.addCookies([{name:'life-os-language',value:'en',url:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000'}]);await page.addInitScript(data=>{if(!localStorage.getItem('life-os:local:v1'))localStorage.setItem('life-os:local:v1',JSON.stringify(data));localStorage.setItem('life-os:language','en');},data);});

async function open(page:Page){await page.goto('/');await expect(page.getByRole('heading',{name:'Your timeline'})).toBeVisible();}
async function demo(page:Page){await open(page);await page.getByRole('button',{name:/Take a look around/}).click();await expect(page.locator('.mode-banner')).toBeVisible();await expect(page.locator('.activity-block')).not.toHaveCount(0);await page.getByRole('button',{name:'Dismiss message'}).click({timeout:1000}).catch(()=>{});await expect(page.getByRole('status')).toHaveCount(0);}
async function navigate(page:Page,label:string){const mobile=await page.locator('.mobile-nav').isVisible();if(label==='Settings'){if(mobile){await page.getByRole('button',{name:'Open profile'}).click();await page.getByRole('button',{name:'Personal settings'}).click();}else await page.locator('.sidebar-bottom').getByRole('button',{name:'Settings',exact:true}).click();return;}if(label==='Nutrition'&&mobile){await page.goto('/?view=nutrition');await expect(page.getByRole('heading',{name:'A little care, every meal.'})).toBeVisible();return;}await page.locator(mobile?'.mobile-nav':'.sidebar nav').getByRole('button',{name:mobile&&label==='AI Planner'?'AI':label,exact:true}).click();}
async function add(page:Page,title:string,start='09:00',end='10:00'){
  await page.getByRole('button',{name:'Quick add'}).click();const form=page.getByRole('dialog');await form.getByLabel('Activity name').fill(title);await form.getByLabel('Starts at').fill(start);await form.getByLabel('Ends at').fill(end);await form.getByRole('button',{name:'Add activity',exact:true}).click();return form;
}

test('timeline CRUD, completion, skip, undo, reload and date navigation',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await add(page,'Deep work');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('.activity-block')).toHaveCount(1);
  await page.getByRole('button',{name:'Complete Deep work',exact:true}).click();await expect(page.locator('.state-completed')).toHaveCount(1);
  await page.reload();await expect(page.locator('.state-completed')).toHaveCount(1);
  await page.getByRole('button',{name:'View Deep work',exact:true}).click();await page.getByRole('button',{name:'Edit / reschedule'}).click();await page.getByRole('dialog').getByLabel('Activity name').fill('Focused work');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'View Focused work',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View Focused work',exact:true}).click();await page.getByRole('button',{name:'Skip for now'}).click();await expect(page.locator('.state-skipped')).toHaveCount(1);
  await page.getByRole('status').getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.state-completed')).toHaveCount(1);
  await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.locator('.timeline-empty')).toBeVisible();await page.getByRole('button',{name:'Previous day',exact:true}).click();await expect(page.locator('.activity-block')).toHaveCount(1);
  await page.getByRole('button',{name:'View Focused work',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Delete this activity?'})}).getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.locator('.activity-block')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('conflicts require review and overnight events remain on next day',async({page})=>{
  await open(page);await add(page,'Morning study');const form=await add(page,'Overlapping focus','09:30','10:30');await expect(form.getByRole('alert')).toContainText('These times overlap');await expect(page.locator('.activity-block')).toHaveCount(1);await form.getByRole('button',{name:'Save with overlap'}).click();await expect(page.locator('.has-conflict')).toHaveCount(2);
  await page.getByRole('button',{name:'Quick add'}).click();const night=page.getByRole('dialog');await night.getByLabel('Activity name').fill('Late reading');await night.getByLabel('Starts at').fill('23:30');await night.getByLabel('Ends at').fill('00:30');const day=await night.getByLabel('Start date').inputValue();const next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);await night.getByLabel('End date').fill(next.toISOString().slice(0,10));await night.getByRole('button',{name:'Add activity',exact:true}).click();await page.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByRole('button',{name:'View Late reading',exact:true})).toBeVisible();
});

test('weekly classes and exceptions synchronize with calendar timetable',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Quick add'}).click();const form=page.getByRole('dialog');await form.getByLabel('Activity name').fill('Java class');await form.getByRole('button',{name:'Study',exact:true}).click();await form.getByLabel('Repeat weekly').check();await form.getByLabel('Location').fill('Room 402');await form.getByRole('button',{name:'Add activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'View Java class',exact:true})).toBeVisible();await page.getByRole('button',{name:'View Java class',exact:true}).click();await page.getByRole('button',{name:'Edit / reschedule'}).click();await page.getByRole('dialog').getByLabel('Location').fill('Room 405');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.activity-location')).toHaveCount(1);await expect(page.locator('.activity-location')).toContainText('Room 405');
  await navigate(page,'Calendar');await page.getByRole('button',{name:'University timetable'}).click();await expect(page.getByRole('button').filter({hasText:'Java class'})).not.toHaveCount(0);
});

test('task duration schedules working time separate from deadline',async({page})=>{
  await open(page);await navigate(page,'Tasks');await page.getByRole('button',{name:'Add a task',exact:true}).first().click();const form=page.getByRole('dialog');await form.getByLabel('Task name').fill('Write assignment');await form.getByLabel('Estimated minutes').fill('180');await form.getByRole('button',{name:'Save task'}).click();await page.getByRole('button',{name:'Schedule',exact:true}).click();const event=page.getByRole('dialog');await expect(event.getByLabel('Activity name')).toHaveValue('Write assignment');await expect(event.getByLabel('Ends at')).toHaveValue('12:00');await event.getByRole('button',{name:'Add activity',exact:true}).click();await navigate(page,'Today');await expect(page.getByRole('button',{name:'View Write assignment',exact:true})).toBeVisible();
});

for(const width of [375,390,768,1024,1440]){
  test(`responsive views at ${width}px have no document overflow`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});await demo(page);
    for(const label of ['Today','Calendar','Tasks','Nutrition','Workout','AI Planner','Settings']){
      if(label!=='Today')await navigate(page,label);
      await expect(page.locator('main h1')).toHaveCount(1);
      const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));expect(dimensions.scroll,`${label} overflows`).toBeLessThanOrEqual(dimensions.viewport);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:testInfo.outputPath(`${label.toLowerCase().replaceAll(' ','-')}-${width}.png`),fullPage:true});
      if(label==='Today')await page.screenshot({path:testInfo.outputPath(`today-viewport-${width}.png`)});
      if(label==='Calendar'){await page.getByRole('button',{name:'Month',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:testInfo.outputPath(`calendar-month-${width}.png`),fullPage:true});}
    }
  });
}

test('demo mode stays separate from the personal workspace and dark theme persists',async({page},testInfo)=>{
  await demo(page);await page.locator('.sidebar-bottom').getByRole('button',{name:'Dark appearance'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:testInfo.outputPath('dark-desktop.png'),fullPage:true});await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.getByRole('button',{name:'Leave demo'}).click();await expect(page.locator('.timeline-empty')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('module URLs restore after reload and browser back',async({page})=>{
  await open(page);await navigate(page,'Calendar');await expect(page).toHaveURL(/view=calendar/);await page.reload();await expect(page.getByRole('heading',{name:'A little perspective.'})).toBeVisible();await navigate(page,'Tasks');await page.goBack();await expect(page.getByRole('heading',{name:'A little perspective.'})).toBeVisible();
});

test('meal templates schedule canonical events and retain meal history',async({page})=>{
  await open(page);await navigate(page,'Nutrition');await page.getByRole('button',{name:'Favorites',exact:true}).click();await page.getByRole('button',{name:'New template'}).click();const form=page.getByRole('dialog');await form.getByLabel('Meal name').fill('Cơm gà');await form.getByLabel('Calories (kcal) · estimated').fill('620');await form.getByRole('button',{name:'Save favorite'}).click();await page.getByRole('button',{name:'Schedule',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Add activity',exact:true}).click();await navigate(page,'Today');await page.getByRole('button',{name:'Complete Cơm gà',exact:true}).click();await navigate(page,'Nutrition');await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.locator('.module-history-item')).toContainText('Cơm gà');
});

test('workout sessions save actual exercise logs and preserve the timeline state',async({page})=>{
  await open(page);await navigate(page,'Workout');await page.getByRole('button',{name:'Create a plan',exact:true}).click();const form=page.getByRole('dialog');await form.getByLabel('Plan name').fill('Push training');await form.getByRole('button',{name:'Add exercise',exact:true}).click();await form.getByLabel('Exercise 1',{exact:true}).fill('Bench press');await form.getByRole('button',{name:'Save plan',exact:true}).click();await page.getByRole('button',{name:'Schedule',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Add activity',exact:true}).click();await page.getByRole('button',{name:'Sessions',exact:true}).click();await page.getByRole('button',{name:'Start session'}).click();await page.getByRole('dialog').getByLabel('Sets',{exact:true}).fill('4');await page.getByRole('button',{name:'Complete & save logs'}).click();await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.locator('.module-workout-session')).toContainText('4 sets');await expect(page.locator('.module-log-summary')).toContainText('Bench press: 4');await navigate(page,'Today');await expect(page.locator('.state-completed')).toHaveCount(1);
});

test('AI fixture preview stays unapplied until confirmation and cancellation keeps data unchanged',async({page})=>{
  // This tests confirmation UI against an explicit provider fixture, not live Gemini.
  await page.route('**/api/config',route=>route.fulfill({json:{supabaseConfigured:false,aiConfigured:true}}));
  await page.route('**/api/plan',route=>{
    const input=route.request().postDataJSON();
    return route.fulfill({json:{proposal:{id:'fixture-plan',summary:'A clear hour for your project.',warnings:[],events:[{id:'3e2ff215-6fa6-452f-98dd-56cde757b39d',title:'Project focus',description:'Work on the next milestone',category:'work',date:input.date,endDate:input.date,startTime:'10:00',endTime:'11:00',status:'planned',fixed:false,location:'',notes:''}]}}});
  });
  await open(page);await navigate(page,'AI Planner');await page.getByRole('textbox',{name:'What would you like to plan?'}).fill('Make room for an hour of project work.');await page.getByRole('button',{name:'Create my plan'}).click();await expect(page.getByText('Preview · not applied')).toBeVisible();await page.locator('.module-proposal-actions').getByRole('button',{name:'Cancel',exact:true}).click();await navigate(page,'Today');await expect(page.locator('.timeline-empty')).toBeVisible();
  await navigate(page,'AI Planner');await page.getByRole('textbox',{name:'What would you like to plan?'}).fill('Make room for an hour of project work.');await page.getByRole('button',{name:'Create my plan'}).click();await page.getByRole('button',{name:'Accept plan',exact:true}).click();await navigate(page,'Today');await expect(page.getByRole('button',{name:'View Project focus',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'View Project focus',exact:true})).toBeVisible();
});

test('mobile can access nutrition and settings, with a usable activity sheet',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await open(page);await page.getByRole('button',{name:'Nutrition',exact:true}).first().click();await expect(page.getByRole('heading',{name:'A little care, every meal.'})).toBeVisible();await page.getByRole('button',{name:'Open profile'}).click();await page.getByRole('button',{name:'Personal settings'}).click();await expect(page.getByRole('heading',{name:'A rhythm that fits you.'})).toBeVisible();await page.getByRole('button',{name:'Quick add'}).click();await page.getByRole('dialog').getByLabel('Activity name').fill('An intentional evening');await page.screenshot({animations:'disabled',path:testInfo.outputPath('mobile-activity-sheet.png')});await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
});

test('foreground reminders and current activity follow the real clock boundaries',async({page})=>{
  await page.clock.install({time:new Date('2026-10-26T06:50:00+07:00')});await open(page);await add(page,'Morning lecture','07:00','08:00');await expect(page.getByRole('status')).toContainText('Coming up: Morning lecture');await page.clock.fastForward(11*60000);await expect(page.locator('.current-card')).toContainText('Morning lecture');await expect(page.locator('.state-active')).toHaveCount(1);await page.clock.fastForward(60*60000);await expect(page.locator('.state-unconfirmed')).toHaveCount(1);await expect(page.locator('.state-completed')).toHaveCount(0);
});

test('quick entry drafts tomorrow without changing its end date unexpectedly',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Quick add'}).click();const form=page.getByRole('dialog');const today=await form.getByLabel('Start date').inputValue();const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const key=tomorrow.toISOString().slice(0,10);await form.getByLabel('Add in your own words').fill('Tomorrow at 16h gym for 90 minutes');await form.getByRole('button',{name:'Fill form'}).click();await expect(form.getByLabel('Start date')).toHaveValue(key);await expect(form.getByLabel('End date')).toHaveValue(key);await expect(form.getByLabel('Starts at')).toHaveValue('16:00');await expect(form.getByLabel('Ends at')).toHaveValue('17:30');
});
