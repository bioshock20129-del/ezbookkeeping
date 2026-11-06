import { describe, expect, it } from 'vitest';
import { budgetRadarScript } from '../explorer_budget_radar.ts';
import { buildExplorerComparison } from '../explorer_sources.ts';
import { TransactionExplorerQuery } from '@/models/explorer.ts';
import type { ExplorerComparison } from '../explorer_sources.ts';

// Execute the exact editor script through the same JSON-only boundary as CustomChart.
const execute=(comparison: ExplorerComparison & {currency:string})=>JSON.parse(JSON.stringify(new Function(`${budgetRadarScript}; return buildChartOptions([], arguments[0]);`)(comparison)));
function fixture() {
    const actual=TransactionExplorerQuery.create('actual'),budget=TransactionExplorerQuery.create('budget');
    budget.source='budget';
    const plan={revision:1,items:[],budgets:['Еда','Жильё','Подарки'].map((name,i)=>({id:String(i),name,accountId:'a',categoryIds:[String(i)],limit:String((i+1)*100000),estimate:false}))};
    return {...buildExplorerComparison({plan,accounts:{a:{currency:'RUB'}},queries:[actual,budget],forecasts:{},start:'2026-11-01',end:'2026-11-30',today:'2026-11-10',now:Date.parse('2026-11-10T12:00:00Z')/1000,cumulative:true,facts:{actual:[{id:'x',date:'2026-11-01',time:Date.parse('2026-11-01')/1000,kind:3,accountId:'a',destinationId:'',currency:'RUB',destinationCurrency:'',amount:'373',destinationAmount:'0',categoryIds:['0']}]}}),currency:'RUB'};
}
describe('editable budget radar template',()=>{
    it('plots budgets as axes in rubles, with planned dashed and actual solid',()=>{
        const chart=execute(fixture());
        expect(chart.radar.indicator.map((i:{name:string})=>i.name)).toEqual(['Еда (RUB)','Жильё (RUB)','Подарки (RUB)']);
        expect(chart.series[0].type).toBe('radar');
        expect(chart.series[0].data[0].value).toEqual([1000,2000,3000]);
        expect(chart.series[0].data[1].value).toEqual([3.73,0,0]);
        expect(chart.series[0].data.map((d:{lineStyle:{type:string}})=>d.lineStyle.type)).toEqual(['dashed','solid']);
        expect(new Set(chart.radar.indicator.map((i:{max:number})=>i.max)).size).toBe(1);
    });
    it('does not sum duplicate query coverage, and rejects conflicting filters',()=>{
        const comparison=fixture();comparison.series.push({...comparison.series[0]!,id:'copy'});
        expect(execute(comparison).series[0].data[1].value).toEqual([3.73,0,0]);
        comparison.series.at(-1)!.budgets=[{id:'0',name:'Еда',total:'999'}];
        expect(()=>execute(comparison)).toThrow('Разные условия');
    });
    it('explains missing axes or actual coverage instead of inventing zeros',()=>{
        const comparison=fixture();comparison.series=comparison.series.filter(s=>s.source!=='actual');
        expect(()=>execute(comparison)).toThrow('теми же бюджетами');
        expect(()=>execute({...fixture(),currency:'USD'})).toThrow('трёх бюджетов');
        const future=fixture();future.series.find(s=>s.source==='actual')!.daily.fill(null);
        expect(()=>execute(future)).toThrow('прошедшие даты');
    });
});
