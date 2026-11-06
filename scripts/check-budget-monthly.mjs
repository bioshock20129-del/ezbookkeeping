// Disposable loopback API + browser fixture. Never targets an existing user's database.
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL(process.argv[2]||'http://127.0.0.1:18084');
if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Use a disposable loopback server');
async function api(path,body,token){
    const response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Timezone-Name':'UTC',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok||!data.success)throw new Error(path+': '+JSON.stringify(data));return data.result;
}
const suffix=randomUUID().replaceAll('-','').slice(0,10);
const user=await api('/api/register.json',{username:'monthly'+suffix,email:suffix+'@example.test',nickname:'Проверка бюджета',password:randomUUID(),language:'ru',defaultCurrency:'RUB',categories:[]});
const account=await api('/api/v1/accounts/add.json',{name:'Сбер',category:2,type:1,icon:'1',color:'377D6B',currency:'RUB',balance:'12000000',balanceTime:Math.floor(Date.now()/1000)-3600,subAccounts:[]},user.token);
const now=new Date(),monthEnd=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)),date=d=>d.toISOString().slice(0,10);
const start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000,end=monthEnd.getTime()/1000+86399;
const budgets=[];
for(const [i,name,limit,spent] of [[0,'Базовые расходы',6000000,4099000],[1,'Образование',1500000,180000],[2,'Посиделки',2000000,313300],[3,'Подарки',1000000,0]]){
    const category=await api('/api/v1/transaction/categories/add.json',{name,type:2,parentId:'0',icon:'1',color:'EF8F39'},user.token);
    const child=await api('/api/v1/transaction/categories/add.json',{name:name+' · расходы',type:2,parentId:category.id,icon:'1',color:'EF8F39'},user.token);
    budgets.push({id:'budget'+i,name,accountId:account.id,categoryIds:[category.id],limit:String(limit),estimate:false});
    if(spent)await api('/api/v1/transactions/add.json',{type:3,categoryId:child.id,time:Math.floor(Date.now()/1000)-120,utcOffset:0,sourceAccountId:account.id,sourceAmount:spent,tagIds:[],pictureIds:[],comment:'Monthly fixture'},user.token);
}
const paymentDate=date(new Date(Math.min(Date.now()+86400000,monthEnd.getTime())));
await api('/api/v1/planning/save.json',{revision:0,budgets,items:[{id:'rent',name:'Датированный платёж',kind:'expense',accountId:account.id,destinationId:'',budgetId:'budget0',amount:'1246000',date:paymentDate,frequency:'once',endDate:'',optional:false,skipDates:[]}]},user.token);
let preview=await api('/api/v1/planning/preview.json',{through:date(monthEnd),includeOptional:false},user.token);
assert.equal(preview.events.filter(e=>e.source==='estimate').length,0);
assert.equal(preview.events.find(e=>e.source==='planned').date,paymentDate);
let plan=await api('/api/v1/planning/get.json',undefined,user.token);plan.budgets[0].estimate=true;
await api('/api/v1/planning/save.json',plan,user.token);
preview=await api('/api/v1/planning/preview.json',{through:date(monthEnd),includeOptional:false},user.token);
assert.deepEqual(preview.events.filter(e=>e.source==='estimate').map(e=>[e.date,e.amount]),[[date(monthEnd),'-655000']]);
plan=await api('/api/v1/planning/get.json',undefined,user.token);plan.budgets[0].estimate=false;await api('/api/v1/planning/save.json',plan,user.token);
const query=(id,source)=>({id,name:source==='budget'?'План':'Факт',source,flow:'expense',accountIds:[account.id],budgetIds:[],forecastMethod:'plans',includeOptional:false,leftQueryId:'',rightQueryId:'',conditions:[]});
const exploration=await api('/api/v1/insights/explorers/add.json',{name:'Месячный бюджет · радар',data:{queries:[query('a','actual'),query('b','budget')],timezoneUsedForDateRange:0,comparisonChart:'radar',comparisonCurrency:'RUB'}},user.token);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
    const page=await browser.newPage({viewport:{width:1440,height:1080},colorScheme:'dark',timezoneId:'UTC'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(/\[ECharts\].*(not imported|not exists)/.test(m.text()))errors.push(m.text());});
    await page.route('**/api/v1/exchange_rates/latest.json',route=>route.fulfill({json:{success:true,result:{dataSource:'fixture',referenceUrl:'',updateTime:Math.floor(Date.now()/1000),baseCurrency:'RUB',exchangeRates:[{currency:'RUB',rate:'1'}]}}}));
    await page.addInitScript(data=>{
        if(window !== window.top) return;
        localStorage.setItem('ebk_user_token',data.token);localStorage.setItem('ebk_user_info',JSON.stringify(data.user));
        window.__chartResults=[];window.addEventListener('message',event=>{if(typeof event.data?.result==='string'){try{window.__chartResults.push(JSON.parse(event.data.result));}catch{}}});
    },user);
    await page.goto(new URL('/desktop#/planning',base).href,{waitUntil:'networkidle'});
    await page.getByText('Итого за месяц · RUB',{exact:true}).waitFor();
    assert.match(await page.locator('.planning-overview').innerText(),/105\s000\s₽/);
    const total=await page.locator('tfoot').innerText();
    for(const amount of ['105000','45923','12460','46617'])assert.ok(total.replace(/\s/g,'').includes(amount),total);
    assert.equal(await page.getByRole('button',{name:'Бюджеты и прогноз',exact:true}).locator('svg').count(),1);
    if(process.env.BUDGET_SCREENSHOT_DIR)await page.screenshot({path:process.env.BUDGET_SCREENSHOT_DIR+'/monthly-totals.png',fullPage:true});
    const url=new URL(`/desktop#/insights/explorer?id=${exploration.id}&activeTab=chart&dateRangeType=255&startTime=${start}&endTime=${end}`,base).href;
    await page.goto(url,{waitUntil:'networkidle'});
    await page.locator('.custom-chart-container canvas').waitFor();
    const options=await page.evaluate(()=>window.__chartResults.find(o=>o.series?.[0]?.type==='radar'));
    assert.ok(options,'Sandbox did not return a radar');
    assert.deepEqual(options.series[0].data.map(d=>d.value),[[60000,15000,20000,10000],[40990,1800,3133,0]]);
    assert.deepEqual(options.series[0].data.map(d=>d.lineStyle.type),['dashed','solid']);
    if(process.env.BUDGET_SCREENSHOT_DIR){await page.waitForTimeout(300);await page.screenshot({path:process.env.BUDGET_SCREENSHOT_DIR+'/budget-radar.png',fullPage:true});}
    await page.getByRole('button',{name:'Редактировать код диаграммы',exact:true}).click();
    await page.locator('.monaco-editor').waitFor();
    const saving=page.waitForResponse(r=>r.url().includes('/insights/explorers/modify.json'));
    await page.getByRole('button',{name:/Save Exploration|Сохранить исследование/}).click();
    await saving;
    const saved=await api('/api/v1/insights/explorers/get.json?id='+exploration.id,undefined,user.token);
    assert.equal(saved.data.comparisonChart,'custom');assert.match(saved.data.customChartScript,/function buildChartOptions/);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.custom-chart-container canvas').waitFor();
    await page.setViewportSize({width:420,height:920});
    if(process.env.BUDGET_SCREENSHOT_DIR)await page.screenshot({path:process.env.BUDGET_SCREENSHOT_DIR+'/budget-radar-narrow.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Monthly totals: 105,000 RUB; dated payment preserved; optional residual 6,550 RUB only at month end; real radar with exact plan/actual, editable script saved and reloaded.');
}finally{await browser.close();}
