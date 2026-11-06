// Creates its own fixtures on a disposable loopback API; never runs against a remote ledger.
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=new URL(process.argv[2]||'http://127.0.0.1:18084');
if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Use a disposable loopback server');
async function api(path,body,token){
    const response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Timezone-Name':'UTC',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok||!data.success)throw new Error(path+': '+JSON.stringify(data));return data.result;
}
const suffix=randomUUID().replaceAll('-','').slice(0,10);
const user=await api('/api/register.json',{username:'evidence'+suffix,email:suffix+'@example.test',nickname:'Проверка расшифровки',password:randomUUID(),language:'ru',defaultCurrency:'RUB',categories:[]});
const account=await api('/api/v1/accounts/add.json',{name:'Сбер',category:2,type:1,icon:'1',color:'377D6B',currency:'RUB',balance:'20000000',balanceTime:Math.floor(Date.now()/1000)-3600,subAccounts:[]},user.token);
const otherAccount=await api('/api/v1/accounts/add.json',{name:'Другой счёт',category:2,type:1,icon:'1',color:'377D6B',currency:'RUB',balance:'0',balanceTime:Math.floor(Date.now()/1000)-3600,subAccounts:[]},user.token);
async function category(name,type=2,parentId='0'){return api('/api/v1/transaction/categories/add.json',{name,type,parentId,icon:'1',color:'EF8F39'},user.token);}
const housing=await category('Жильё'),rent=await category('Аренда',2,housing.id),utility=await category('Коммунальные',2,housing.id);
const education=await category('Образование'),course=await category('Курсы',2,education.id);
const gifts=await category('Подарки'),gift=await category('Покупка подарка',2,gifts.id);
const salary=await category('Доходы',1),salaryChild=await category('Зарплата',1,salary.id);
const ids={};
async function transaction(key,type,categoryId,amount,comment,overrides={}){
    const result=await api('/api/v1/transactions/add.json',{type,categoryId,time:Math.floor(Date.now()/1000)-120,utcOffset:0,sourceAccountId:account.id,sourceAmount:amount,tagIds:[],pictureIds:[],comment,...overrides},user.token);ids[key]=result.id;
}
await transaction('rent',3,rent.id,6000000,'Аренда за месяц');
await transaction('utility',3,utility.id,2055910,'Коммунальные услуги');
await transaction('excluded',3,rent.id,999999,'EXCLUDE fixture');
await transaction('outside',3,gift.id,200000,'Вне базовых расходов');
await transaction('income',2,salaryChild.id,999999,'Доход не входит в расходы');
await transaction('otherBank',3,rent.id,777777,'Другой счёт не входит в бюджет',{sourceAccountId:otherAccount.id});
await transaction('future',3,rent.id,666666,'Будущая операция',{time:Math.floor(Date.now()/1000)+86400});
const now=new Date(),start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000,end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)/1000-1;
await api('/api/v1/planning/save.json',{revision:0,items:[],budgets:[
    {id:'base',name:'Базовые расходы',accountId:account.id,categoryIds:[housing.id],limit:'6000000',estimate:false},
    {id:'education',name:'Образование',accountId:account.id,categoryIds:[education.id],limit:'1500000',estimate:false},
    {id:'gifts',name:'Подарки',accountId:account.id,categoryIds:[gifts.id],limit:'1000000',estimate:false}
]},user.token);
const query=(id,source)=>({id,name:source==='actual'?'Факт с условиями':'Бюджет',source,flow:'expense',accountIds:[account.id],budgetIds:[],forecastMethod:'plans',includeOptional:false,leftQueryId:'',rightQueryId:'',conditions:source==='actual'?[{relation:'first',condition:{field:'description',operator:'notContains',value:'EXCLUDE'}}]:[]});
const exploration=await api('/api/v1/insights/explorers/add.json',{name:'Расшифровка',data:{queries:[query('actual','actual'),query('budget','budget')],timezoneUsedForDateRange:0,comparisonChart:'radar',comparisonCurrency:'RUB'}},user.token);
const url=tab=>new URL(`/desktop#/insights/explorer?id=${exploration.id}&activeTab=${tab}&dateRangeType=255&startTime=${start}&endTime=${end}`,base).href;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
    const page=await browser.newPage({viewport:{width:1500,height:1100},colorScheme:'dark',timezoneId:'UTC'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/v1/exchange_rates/latest.json',route=>route.fulfill({json:{success:true,result:{dataSource:'fixture',referenceUrl:'',updateTime:Math.floor(Date.now()/1000),baseCurrency:'RUB',exchangeRates:[{currency:'RUB',rate:'1'}]}}}));
    await page.addInitScript(data=>{if(window!==window.top)return;localStorage.setItem('ebk_user_token',data.token);localStorage.setItem('ebk_user_info',JSON.stringify(data.user));},user);
    await page.goto(url('chart'),{waitUntil:'networkidle'});
    const budgetButton=page.getByRole('button',{name:/Базовые расходы ·/});
    await budgetButton.waitFor();await budgetButton.click();
    const dialog=page.getByRole('dialog').filter({hasText:'Транзакции в расчёте'});
    await dialog.locator('.evidence-transactions tbody tr').first().waitFor();
    const totals=await dialog.locator('.evidence-totals').innerText();
    for(const value of ['80559,10','60000','20559,10'])assert.ok(totals.replace(/\s/g,'').includes(value),totals);
    assert.equal(await dialog.locator('.evidence-transactions tbody tr').count(),2);
    const content=await dialog.innerText();
    for(const excluded of ['EXCLUDE fixture','Вне базовых расходов','Будущая операция','Другой счёт не входит'])assert.ok(!content.includes(excluded),excluded);
    assert.equal(await dialog.locator('.v-alert--type-error').count(),0);
    assert.ok(!content.includes('dataFooter.')&&!content.includes('{0}'));
    assert.match(content,/1–2 из 2/);
    const downloading=page.waitForEvent('download');await dialog.getByRole('button',{name:'Скачать транзакции CSV'}).click();
    const csv=await readFile(await (await downloading).path(),'utf8');
    assert.ok(csv.includes(ids.rent)&&csv.includes(ids.utility)&&!csv.includes(ids.excluded));
    assert.ok(csv.includes('60000.00')&&csv.includes('20559.10'));
    await dialog.getByRole('textbox',{name:'Поиск по категории, счёту, комментарию или ID'}).fill('Коммунальные');
    assert.equal(await dialog.locator('.evidence-transactions tbody tr').count(),1);
    assert.match(await dialog.locator('.evidence-filter-total').innerText(),/20\s?559,10/);
    await dialog.getByRole('textbox',{name:'Поиск по категории, счёту, комментарию или ID'}).fill('');
    await dialog.locator('.v-card-text').evaluate(node => node.scrollTo(0,0));
    if(process.env.EVIDENCE_SCREENSHOT_DIR)await page.screenshot({path:process.env.EVIDENCE_SCREENSHOT_DIR+'/transaction-evidence.png',fullPage:true});
    await page.setViewportSize({width:420,height:920});
    if(process.env.EVIDENCE_SCREENSHOT_DIR)await page.screenshot({path:process.env.EVIDENCE_SCREENSHOT_DIR+'/transaction-evidence-narrow.png',fullPage:true});
    await page.setViewportSize({width:1500,height:1100});
    await dialog.getByRole('button',{name:'Открыть транзакцию '+ids.rent,exact:true}).click();
    await page.getByRole('dialog').locator('textarea').first().waitFor();
    assert.equal(await page.getByRole('dialog').locator('textarea').first().inputValue(),'Аренда за месяц');
    await page.keyboard.press('Escape');
    await page.goto(url('table'),{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Транзакции в расчёте',exact:true}).click();
    const tableDialog=page.getByRole('dialog').filter({hasText:'Транзакции в расчёте'});
    await tableDialog.locator('.evidence-transactions tbody tr').first().waitFor();
    assert.equal(await tableDialog.locator('.evidence-transactions tbody tr').count(),3);
    await tableDialog.getByRole('combobox',{name:'Бюджет',exact:true}).focus();
    await tableDialog.getByRole('combobox',{name:'Бюджет',exact:true}).press('ArrowDown');
    await page.getByRole('option',{name:'Подарки',exact:true}).click();
    assert.equal(await tableDialog.locator('.evidence-transactions tbody tr').count(),1);
    assert.match(await tableDialog.locator('.evidence-totals').innerText(),/2\s?000/);
    await tableDialog.getByRole('button',{name:'Закрыть',exact:true}).click();
    const saved=await api('/api/v1/insights/explorers/get.json?id='+exploration.id,undefined,user.token);
    const customChartScript=`function buildChartOptions(transactions, comparison) {
        if (comparison.evidence || transactions.length) throw new Error('Raw ledger data must stay outside the chart sandbox');
        const actual=comparison.series.find(s=>s.source==='actual'&&s.currency===comparison.currency);
        return {xAxis:{type:'category',data:actual.budgets.map(b=>b.name)},yAxis:{type:'value'},series:[{type:'bar',data:actual.budgets.map(b=>Number(b.total)/100)}]};
    }`;
    await api('/api/v1/insights/explorers/modify.json',{id:exploration.id,name:saved.name,data:{...saved.data,comparisonChart:'custom',customChartDisplayLayout:2,customChartScript},clientSessionId:randomUUID()},user.token);
    await page.goto(url('chart'),{waitUntil:'networkidle'});await page.reload({waitUntil:'networkidle'});
    await page.locator('.custom-chart-container canvas').waitFor();
    await page.getByRole('button',{name:/Базовые расходы ·/}).click();
    const customDialog=page.getByRole('dialog').filter({hasText:'Транзакции в расчёте'});
    assert.equal(await customDialog.locator('.evidence-transactions tbody tr').count(),2);
    assert.match(await customDialog.locator('.evidence-totals').innerText(),/80\s?559,10/);
    assert.deepEqual(errors,[]);
    console.log('Exact 80,559.10 RUB evidence = rent 60,000 + utilities 20,559.10; query conditions, budget/account/time filters, category totals, search, CSV, transaction opening table-mode and saved custom-chart drilldown verified.');
}finally{await browser.close();}
