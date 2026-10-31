// End-to-end check against a disposable local server. Creates its own test user.
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';
const base = new URL(process.argv[2] || 'http://127.0.0.1:18083');
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Use a disposable loopback server for this fixture-creating test');
async function api(path, body, token) {
    const response = await fetch(new URL(path, base), {method:'POST',headers:{'Content-Type':'application/json','X-Timezone-Name':'UTC',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok||!data.success)throw new Error(`Fixture API ${path}: ${data.errorMessage || response.status}`);
    return data.result;
}
const suffix=randomUUID().replaceAll('-','').slice(0,10);
const user=await api('/api/register.json',{username:`planning${suffix}`,email:`planning${suffix}@example.test`,nickname:'Проверка планирования',password:randomUUID(),language:'ru',defaultCurrency:'RUB',categories:[]});
const account=await api('/api/v1/accounts/add.json',{name:'Сбер · основной',category:2,type:1,icon:'1',color:'377D6B',currency:'RUB',balance:'12000000',balanceTime:Math.floor(Date.now()/1000)-60,subAccounts:[]},user.token);
await api('/api/v1/accounts/add.json',{name:'Накопления',category:8,type:1,icon:'1',color:'377D6B',currency:'RUB',balance:'5000000',balanceTime:Math.floor(Date.now()/1000)-60,subAccounts:[]},user.token);
const category=await api('/api/v1/transaction/categories/add.json',{name:'Питание',type:2,parentId:'0',icon:'1',color:'EF8F39'},user.token);
await api('/api/v1/transaction/categories/add.json',{name:'Продукты',type:2,parentId:category.id,icon:'1',color:'EF8F39'},user.token);
const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const item=(id,name,kind,days,amount)=>({id,name,kind,accountId:account.id,destinationId:'',budgetId:'',amount,date:future(days),frequency:'monthly',endDate:'',optional:false,skipDates:[]});
await api('/api/v1/planning/save.json',{revision:0,budgets:[{id:'food',name:'Продукты и обеды',accountId:account.id,categoryIds:[category.id],limit:'2500000',estimate:true}],items:[item('salary','Зарплата','income',5,'15000000'),item('rent','Аренда квартиры','expense',10,'4000000')]},user.token);
async function checkDialogSpacing(dialog, label) {
    const issues=await dialog.evaluate(root=>{
        const fields=Array.from(root.querySelectorAll('.v-input')).filter(node=>node.getBoundingClientRect().height>0).map(node=>{
            const bounds=node.getBoundingClientRect();
            const labels=Array.from(node.querySelectorAll('.v-field-label--floating')).filter(label=>getComputedStyle(label).visibility!=='hidden'&&Number(getComputedStyle(label).opacity)>0).map(label=>label.getBoundingClientRect());
            return {name:node.textContent.trim().slice(0,50),left:bounds.left,right:bounds.right,top:Math.min(bounds.top,...labels.map(r=>r.top)),bottom:Math.max(bounds.bottom,...labels.map(r=>r.bottom))};
        });
        const errors=[];
        for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++){
            const a=fields[i],b=fields[j];
            if(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1)continue;
            const gap=Math.max(a.top,b.top)-Math.min(a.bottom,b.bottom);
            if(gap<8)errors.push(`${a.name} / ${b.name}: vertical gap ${gap.toFixed(1)}px`);
        }
        return errors;
    });
    if(issues.length)throw new Error(`${label}: ${issues.join('; ')}`);
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
    for(const colorScheme of ['dark','light']) {
        const page=await browser.newPage({viewport:{width:1440,height:1050},colorScheme});
        const failures=[];
        page.on('pageerror',error=>failures.push(error.message));
        page.on('response',response=>{if(response.url().includes('/api/')&&response.status()>=400)failures.push(`${response.status()} ${response.url()}`);});
        // Currency provider availability is outside this test. Planning API uses real SQLite data.
        await page.route('**/api/v1/exchange_rates/latest.json',route=>route.fulfill({json:{success:true,result:{dataSource:'fixture',referenceUrl:'',updateTime:Math.floor(Date.now()/1000),baseCurrency:'RUB',exchangeRates:[{currency:'RUB',rate:'1'}]}}}));
        await page.addInitScript(data=>{localStorage.setItem('ebk_user_token',data.token);localStorage.setItem('ebk_user_info',JSON.stringify(data.user));},user);
        await page.goto(new URL('/desktop#/planning',base).href,{waitUntil:'networkidle'});
        await page.getByRole('heading',{name:'Бюджеты и прогноз',exact:true}).waitFor();
        await page.getByText('Продукты и обеды',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Изменить',exact:true}).first().click();
        const dialog=page.getByRole('dialog');
        await dialog.getByLabel('Название',{exact:true}).fill('Продукты и обеды');
        await checkDialogSpacing(dialog,'budget editor');
        await dialog.getByRole('button',{name:'Применить',exact:true}).click();
        const saved=page.waitForResponse(response=>response.url().endsWith('/api/v1/planning/save.json')&&response.request().method()==='POST');
        await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
        if(!(await (await saved).json()).success)throw new Error('Plan was not saved');
        if(colorScheme==='dark') {
            await page.getByRole('button',{name:'Добавить бюджет',exact:true}).click();
            const editor=page.getByRole('dialog');
            await editor.getByLabel('Название',{exact:true}).fill('Резерв на продукты');
            await editor.getByRole('combobox',{name:'Счёт',exact:true}).focus();
            await editor.getByRole('combobox',{name:'Счёт',exact:true}).press('ArrowDown');
            await page.getByRole('option',{name:'Накопления · RUB',exact:true}).click();
            await editor.getByRole('combobox',{name:'Категории расходов',exact:true}).focus();
            await editor.getByRole('combobox',{name:'Категории расходов',exact:true}).press('ArrowDown');
            await page.getByRole('option',{name:'Питание',exact:true}).click();
            await page.keyboard.press('Escape');
            await editor.getByLabel('Месячный лимит',{exact:true}).fill('10000');
            await checkDialogSpacing(editor,'new budget');
            if(process.env.PLANNING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PLANNING_SCREENSHOT_DIR}/budget-dialog.png`});
            await page.setViewportSize({width:420,height:920});
            await checkDialogSpacing(editor,'new budget narrow');
            await page.setViewportSize({width:1440,height:1050});
            await editor.getByRole('button',{name:'Добавить',exact:true}).click();
            try {await editor.waitFor({state:'hidden',timeout:2000});}catch {throw new Error('Dialog validation failed: '+await editor.innerText());}
            const created=page.waitForResponse(response=>response.url().endsWith('/api/v1/planning/save.json'));
            await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
            if(!(await (await created).json()).success)throw new Error('New budget was not saved');
            await page.getByText('Резерв на продукты',{exact:true}).waitFor();
        }
        await page.getByRole('button',{name:'Сохранить изменения',exact:true}).waitFor();
        await page.waitForFunction(()=>!document.querySelector('.v-progress-circular--indeterminate'));
        if(process.env.PLANNING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PLANNING_SCREENSHOT_DIR}/planning-${colorScheme}.png`,fullPage:true});
        await page.getByRole('tab',{name:'Доходы и платежи',exact:true}).click();
        await page.getByText('Зарплата',{exact:true}).waitFor();
        if(colorScheme==='dark') {
            await page.getByRole('button',{name:'Добавить план',exact:true}).click();
            const editor=page.getByRole('dialog');
            await editor.getByLabel('Название',{exact:true}).fill('Разовая премия');
            await editor.getByRole('combobox',{name:'Тип',exact:true}).focus();
            await editor.getByRole('combobox',{name:'Тип',exact:true}).press('ArrowDown');
            await page.getByRole('option',{name:'Доход',exact:true}).click();
            await editor.getByRole('combobox',{name:'Счёт',exact:true}).focus();
            await editor.getByRole('combobox',{name:'Счёт',exact:true}).press('ArrowDown');
            await page.getByRole('option',{name:'Накопления · RUB',exact:true}).click();
            await editor.getByLabel('Сумма',{exact:true}).fill('1500');
            await editor.getByLabel('Дата',{exact:true}).fill(future(3));
            await checkDialogSpacing(editor,'new item');
            await editor.getByRole('button',{name:'Повторы и уже оплаченные даты',exact:true}).click();
            await editor.getByLabel('Последняя дата (необязательно)',{exact:true}).waitFor({state:'visible'});
            await checkDialogSpacing(editor,'new item expanded');
            if(process.env.PLANNING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PLANNING_SCREENSHOT_DIR}/item-dialog.png`});
            await page.setViewportSize({width:420,height:920});
            await checkDialogSpacing(editor,'new item narrow');
            if(process.env.PLANNING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PLANNING_SCREENSHOT_DIR}/item-dialog-narrow.png`});
            await page.setViewportSize({width:1440,height:1050});
            await editor.getByRole('button',{name:'Добавить',exact:true}).click();
            try {await editor.waitFor({state:'hidden',timeout:2000});}catch {throw new Error('Dialog validation failed: '+await editor.innerText());}
            const created=page.waitForResponse(response=>response.url().endsWith('/api/v1/planning/save.json'));
            await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
            if(!(await (await created).json()).success)throw new Error('New income was not saved');
            await page.getByText('Разовая премия',{exact:true}).waitFor();
        }
        await page.getByRole('tab',{name:'Прогноз',exact:true}).click();
        const preview=page.waitForResponse(response=>response.url().endsWith('/api/v1/planning/preview.json'));
        await page.getByRole('button',{name:'Рассчитать',exact:true}).click();
        const forecast=await (await preview).json();
        if(!forecast.success)throw new Error('Forecast failed');
        if(!forecast.result.events.some(event=>event.name==='Разовая премия'))throw new Error('New income missing from forecast');
        await page.getByRole('heading',{name:'Из чего складывается прогноз',exact:true}).waitFor();
        if(process.env.PLANNING_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PLANNING_SCREENSHOT_DIR}/forecast-${colorScheme}.png`,fullPage:true});
        if(failures.length)throw new Error(failures.join('\n'));
        console.log(`${colorScheme}: authenticated plan load, budget dialog, real save/preview API and forecast passed`);
        await page.close();
    }
    const failedPage=await browser.newPage();
    await failedPage.route('**/api/v1/exchange_rates/latest.json',route=>route.fulfill({json:{success:true,result:{dataSource:'fixture',referenceUrl:'',updateTime:Math.floor(Date.now()/1000),baseCurrency:'RUB',exchangeRates:[{currency:'RUB',rate:'1'}]}}}));
    await failedPage.addInitScript(data=>{localStorage.setItem('ebk_user_token',data.token);localStorage.setItem('ebk_user_info',JSON.stringify(data.user));},user);
    await failedPage.route('**/api/v1/planning/get.json',route=>route.fulfill({status:404,json:{success:false,errorMessage:'api not found'}}));
    await failedPage.goto(new URL('/desktop#/planning',base).href,{waitUntil:'networkidle'});
    await failedPage.getByText('Не удалось загрузить данные планирования. Обновите образ форка и повторите загрузку.',{exact:true}).waitFor();
    if(!await failedPage.getByRole('button',{name:'Сохранить изменения',exact:true}).isDisabled())throw new Error('Save allowed after a failed load');
    if(await failedPage.getByRole('button',{name:'Добавить бюджет',exact:true}).count())throw new Error('Editor shown after a failed load');
    await failedPage.unroute('**/api/v1/planning/get.json');
    await failedPage.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    await failedPage.getByText('Продукты и обеды',{exact:true}).waitFor();
    console.log('Failed plan load blocks editing; retry recovers with real API data');
    await failedPage.close();
} finally {await browser.close();}
