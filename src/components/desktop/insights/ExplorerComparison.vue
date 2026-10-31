<template>
    <v-card-text class="comparison-panel">
        <div class="comparison-toolbar">
            <v-select label="Представление" :items="[{id:true,name:'Накопительно'},{id:false,name:'По дням'}]" item-title="name" item-value="id" v-model="exploration.comparisonCumulative" hide-details />
            <v-select v-if="mode === 'chart'" label="График" :items="[{id:'line',name:'Линии'},{id:'bar',name:'Столбцы'}]" item-title="name" item-value="id" v-model="exploration.comparisonChart" hide-details />
            <v-select label="Валюта" :items="comparison?.currencies || []" :model-value="currency" @update:model-value="exploration.comparisonCurrency = $event" hide-details />
            <v-btn variant="outlined" :disabled="busy || !!error || !visibleSeries.length" @click="downloadCSV">Скачать CSV</v-btn>
            <v-btn variant="text" :loading="busy" :disabled="loading" @click="load">Обновить расчёт</v-btn>
        </div>
        <v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert>
        <v-progress-linear v-if="busy || loading" indeterminate class="mt-4" />
        <template v-else-if="comparison && !error">
            <p class="text-medium-emphasis text-body-small my-4">Один период и календарь приложения · валюты сравниваются отдельно · фактические расходы показаны до текущего момента. Бюджет — равномерный план, прогноз — сценарий. Данные расчёта не создают транзакций.</p>
            <div class="comparison-totals">
                <div v-for="series in visibleSeries" :key="series.id" class="comparison-total">
                    <span class="text-body-small text-medium-emphasis">{{ sourceName(series.source) }} · {{ series.name }}</span>
                    <strong>{{ series.daily.every(v => v === null) ? '—' : formatPlanningMoney(total(series), currency) }}</strong>
                    <span class="text-body-small text-medium-emphasis">{{ series.source === 'actual' || series.source === 'difference' ? 'По последней доступной дате' : 'За выбранный период' }}</span>
                </div>
            </div>
            <v-chart v-if="mode === 'chart' && visibleSeries.length" class="comparison-chart mt-4" autoresize :option="chartOptions" :update-options="{notMerge:true}" />
            <v-table v-if="mode === 'table'" fixed-header height="620" class="mt-4 comparison-table">
                <thead><tr><th>Дата</th><th v-for="series in visibleSeries" :key="series.id">{{ series.name }}<small>{{ sourceName(series.source) }} · {{ currency }}</small></th></tr></thead>
                <tbody><tr v-for="(date,index) in comparison.dates" :key="date"><td>{{ date }}</td><td v-for="series in visibleSeries" :key="series.id">{{ series.values[index] === null ? '—' : formatPlanningMoney(series.values[index] || '0', currency) }}</td></tr></tbody>
            </v-table>
            <v-alert v-if="!visibleSeries.length" type="info" variant="tonal" class="mt-4">Для выбранных источников нет данных в этой валюте.</v-alert>
            <p v-if="mode === 'table'" class="text-body-small text-medium-emphasis mt-4">Расчётная таблица доступна только для чтения. Для изменения бюджета или платежа откройте <router-link to="/planning">«Бюджеты и прогноз»</router-link>.</p>
        </template>
    </v-card-text>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useTheme } from 'vuetify';
import Decimal from 'decimal.js';
import type { EChartsOption } from 'echarts';
import { useExplorersStore } from '@/stores/explorer.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useUserStore } from '@/stores/user.ts';
import { AccountType } from '@/core/account.ts';
import { TimezoneTypeForStatistics } from '@/core/timezone.ts';
import { getCurrentUnixTime, parseDateTimeFromUnixTime } from '@/lib/datetime.ts';
import { planningRequest, formatPlanningMoney, type FinancialPlan, type ForecastResult } from '@/lib/planning.ts';
import { buildExplorerComparison, calendarDays, type ExplorerSeries } from '@/lib/explorer_sources.ts';
const props=defineProps<{mode:'chart'|'table';loading?:boolean}>();
const explorers=useExplorersStore(),accounts=useAccountsStore(),user=useUserStore(),theme=useTheme();
const exploration=computed(()=>explorers.currentExploration);
const plan=ref<FinancialPlan>(),forecasts=ref<Record<string,ForecastResult>>({});
const busy=ref(false),loadError=ref(''),now=ref(getCurrentUnixTime());let generation=0;
const date=(time:number)=>parseDateTimeFromUnixTime(time).getGregorianCalendarYearDashMonthDashDay();
const bounds=computed(()=>({start:date(explorers.transactionExplorerFilter.startTime),end:date(explorers.transactionExplorerFilter.endTime)}));
const today=computed(()=>date(now.value));
const sourceKey=computed(()=>JSON.stringify({bounds:bounds.value,timezone:exploration.value.timezoneUsedForDateRange,queries:exploration.value.queries.map(q=>q.toJsonObject())}));
const calculated=computed(()=>{
    if(!plan.value||loadError.value)return {data:undefined,error:''};
    try {
        if(exploration.value.timezoneUsedForDateRange===TimezoneTypeForStatistics.TransactionTimezone.type)throw new Error('Для сравнения с бюджетом выберите часовой пояс приложения в настройках исследования.');
        return {data:buildExplorerComparison({queries:exploration.value.queries,facts:Object.fromEntries(exploration.value.queries.filter(q=>q.source!=='difference').map(q=>[q.id,explorers.comparisonFactsForQuery(q)])),plan:plan.value,accounts:Object.fromEntries(accounts.allPlainAccounts.filter(a=>a.type!==AccountType.MultiSubAccounts.type).map(a=>[a.id,{currency:a.currency}])),forecasts:forecasts.value,...bounds.value,today:today.value,now:now.value,cumulative:exploration.value.comparisonCumulative}),error:''};
    } catch(e){return {data:undefined,error:e instanceof Error?e.message:'Не удалось рассчитать сравнение.'};}
});
const error=computed(()=>loadError.value||calculated.value.error);
const comparison=computed(()=>calculated.value.data);
const currency=computed(()=>comparison.value?.currencies.includes(exploration.value.comparisonCurrency)?exploration.value.comparisonCurrency:comparison.value?.currencies.includes(user.currentUserDefaultCurrency)?user.currentUserDefaultCurrency:comparison.value?.currencies[0]||'');
const visibleSeries=computed(()=>comparison.value?.series.filter(s=>s.currency===currency.value)||[]);
const sourceName=(source:string)=>({actual:'Факт',budget:'Бюджет',forecast:'Прогноз',difference:'Разница'}[source]||source);
function total(series:ExplorerSeries):string {return series.daily.reduce<Decimal>((a,v)=>v===null?a:a.add(v),new Decimal(0)).toFixed(0);}
async function load(){
    const id=++generation;plan.value=undefined;forecasts.value={};loadError.value='';busy.value=true;
    try {
        calendarDays(bounds.value.start,bounds.value.end);
        const financialPlan=await planningRequest<FinancialPlan>('planning/get.json');
        const scenarios=[...new Set(exploration.value.queries.filter(q=>q.source==='forecast'&&q.forecastMethod==='plans').map(q=>q.includeOptional?'optional':'required'))];
        const previews:Record<string,ForecastResult>={};const current=getCurrentUnixTime();
        if(bounds.value.end>=date(current))for(const scenario of scenarios)previews[scenario]=await planningRequest<ForecastResult>('planning/preview.json',{through:bounds.value.end,includeOptional:scenario==='optional'});
        if(id!==generation)return;
        plan.value=financialPlan;forecasts.value=previews;now.value=Object.values(previews)[0]?Math.floor(Date.parse(Object.values(previews)[0]!.asOf)/1000):current;
    } catch(e){if(id===generation)loadError.value=e instanceof Error?e.message:'Не удалось загрузить данные.';}
    finally {if(id===generation)busy.value=false;}
}
watch([sourceKey,()=>props.loading],()=>{if(props.loading){generation++;plan.value=undefined;busy.value=false;}else void load();},{immediate:true});
onBeforeUnmount(()=>{generation++;});
const chartOptions=computed<EChartsOption>(()=>{
    const text=theme.global.name.value==='dark'?'#ddd':'#454545';
    const dates=comparison.value?.dates||[];
    const forecastAnchor=Math.max(0,dates.findIndex(d=>d>=today.value)-1);
    const hasFuture=dates.some(d=>d>=today.value);
    const options:EChartsOption={color:['#60a5fa','#d8a45e','#45bfa9','#e47d88','#ad8cec','#dfb652'],textStyle:{color:text},tooltip:{trigger:'axis',renderMode:'richText',valueFormatter:value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':formatPlanningMoney(new Decimal(String(value)).mul(100).toFixed(0),currency.value)},legend:{type:'scroll',bottom:0,textStyle:{color:text}},grid:{left:16,right:24,top:36,bottom:92,containLabel:true},xAxis:{type:'category',data:comparison.value?.dates||[],boundaryGap:exploration.value.comparisonChart==='bar',axisLabel:{color:text}},yAxis:{type:'value',name:currency.value,axisLabel:{color:text},splitLine:{lineStyle:{color:theme.global.name.value==='dark'?'#ffffff16':'#00000016'}}},dataZoom:[{type:'inside'},{type:'slider',bottom:32,height:18}],series:visibleSeries.value.map((s,index)=>({id:s.id,name:s.name,type:exploration.value.comparisonChart,showSymbol:dates.length===1,connectNulls:false,data:s.values.map((v,i)=>v===null||(s.source==='forecast'&&hasFuture&&i<forecastAnchor)?null:new Decimal(v).div(100).toNumber()),lineStyle:{width:s.source==='forecast'?3:2,type:s.source==='budget'?'dashed':s.source==='difference'?'dotted':'solid'},...(index===0?{markLine:{symbol:'none',silent:true,label:{formatter:'Сегодня'},lineStyle:{color:text,type:'dashed'},data:[{xAxis:today.value}]}}:{})}))};
    return options;
});
function downloadCSV(){
    if(!comparison.value)return;
    const cell=(value:string)=>'"'+(/^[=+@\-\t\r]/.test(value)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
    const rows=[['Дата','Валюта',...visibleSeries.value.map(s=>s.name+' · '+sourceName(s.source))],...comparison.value.dates.map((date,i)=>[date,currency.value,...visibleSeries.value.map(s=>s.values[i]===null?'':new Decimal(s.values[i]||0).div(100).toFixed(2))])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ezbook-fact-budget-forecast.csv';a.click();URL.revokeObjectURL(url);
}
</script>
<style scoped>
.comparison-toolbar{display:flex;flex-wrap:wrap;gap:20px;align-items:center;padding-top:12px;}.comparison-toolbar .v-input{min-width:160px;flex:1;max-width:280px;}
.comparison-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;}.comparison-total{display:flex;flex-direction:column;gap:6px;padding:18px;border:1px solid var(--ebk-border);border-radius:10px;background:var(--ebk-surface);}.comparison-total strong{font-size:1.4rem;font-variant-numeric:tabular-nums;}.comparison-chart{height:480px;width:100%;}.comparison-table small{display:block;font-weight:normal;}.comparison-table td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
</style>
