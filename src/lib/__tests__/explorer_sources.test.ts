import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { buildExplorerComparison, budgetDayAmount, calendarDays, type ExplorerFact } from '../explorer_sources.ts';
import { TransactionExplorerQuery, InsightsExplorer } from '@/models/explorer.ts';
import type { FinancialPlan, ForecastEvent, ForecastResult } from '../planning.ts';
const q=(id:string,source:TransactionExplorerQuery['source'])=>{const query=TransactionExplorerQuery.create(id);query.source=source;query.name=id;query.budgetIds=['food'];return query;};
const plan:FinancialPlan={revision:1,budgets:[{id:'food',name:'Еда',accountId:'a',categoryIds:['c'],limit:'3000000',estimate:true}],items:[]};
const fact=(date:string,amount:string,overrides:Partial<ExplorerFact>={}):ExplorerFact=>({id:date,date,time:Date.parse(date+'T10:00:00Z')/1000,kind:3,accountId:'a',destinationId:'b',currency:'RUB',destinationCurrency:'USD',amount,destinationAmount:amount,categoryIds:['c'],...overrides});
const preview=(events:ForecastEvent[]):ForecastResult=>({asOf:'2026-11-20T23:59:00Z',through:'2026-11-30',budgets:[],accounts:[],events,points:[],minimum:{}});
const input={plan,accounts:{a:{currency:'RUB'},b:{currency:'USD'}},forecasts:{},start:'2026-11-01',end:'2026-11-30',today:'2026-11-20',now:Date.parse('2026-11-20T23:59:00Z')/1000,cumulative:true};
describe('Explorer query sources',()=>{
    it('compares actual, full-month budget, pace and exact deviation',()=>{
        const actual=q('a','actual'),budget=q('b','budget'),pace=q('p','forecast'),diff=q('d','difference');pace.forecastMethod='pace';diff.leftQueryId='a';diff.rightQueryId='b';
        const result=buildExplorerComparison({...input,queries:[actual,budget,pace,diff],facts:{a:[fact('2026-11-20','2400000')],p:[fact('2026-11-20','2400000')]}});
        const values=(id:string)=>result.series.find(s=>s.id===id)!.values;
        expect(values('a')[19]).toBe('2400000');expect(values('a')[20]).toBeNull();
        expect(values('b')[19]).toBe('2000000');expect(values('b')[29]).toBe('3000000');
        expect(values('p')[29]).toBe('3600000');expect(values('d')[19]).toBe('400000');expect(values('d')[20]).toBeNull();
    });
    it('preserves every cent for leap months and partial ranges without compressing the limit',()=>{
        const days=calendarDays('2028-02-01','2028-02-29');
        expect(days.reduce((a,d)=>a.add(budgetDayAmount('100',d)),new Decimal(0)).toString()).toBe('100');
        const r=buildExplorerComparison({...input,start:'2026-11-15',end:'2026-11-20',queries:[q('b','budget')],facts:{}});
        expect(r.series[0]!.values.at(-1)).toBe('600000');
        expect(()=>calendarDays('2026-01-01','2027-01-02')).toThrow();
    });
    it('uses actual past plus future preview once; ignores transfers for expenses',()=>{
        const forecast=q('p','forecast');
        const event=(kind:string,amount:string,overrides:Partial<ForecastEvent>={}):ForecastEvent=>({id:kind,kind,name:kind,date:'2026-11-21',accountId:'a',budgetId:'food',source:'actual',amount,...overrides});
        const result=buildExplorerComparison({...input,queries:[forecast],facts:{p:[fact('2026-11-20','100'),fact('2026-11-21','200')]},forecasts:{required:preview([event('expense','-200'),event('expense','-50',{source:'planned'}),event('transfer','-10000')])}});
        expect(result.series[0]!.values.at(-1)).toBe('350');
    });
    it('includes later-today plans even when the range ends today',()=>{
        const forecast=q('p','forecast');
        const r=buildExplorerComparison({...input,end:input.today,now:Date.parse('2026-11-20T09:00:00Z')/1000,queries:[forecast],facts:{p:[]},forecasts:{required:preview([{id:'x',name:'lunch',kind:'expense',source:'planned',date:input.today,accountId:'a',budgetId:'food',amount:'-100'}])}});
        expect(r.series[0]!.values.at(-1)).toBe('100');
    });
    it('keeps currencies separate and transfers cancel only within selected accounts',()=>{
        const a=q('a','actual');a.budgetIds=[];a.flow='net';
        const r=buildExplorerComparison({...input,queries:[a],facts:{a:[fact('2026-11-01','10000',{kind:4,destinationAmount:'110'})]}});
        expect(r.currencies).toEqual(['RUB','USD']);expect(r.series.find(s=>s.currency==='RUB')!.values[0]).toBe('-10000');expect(r.series.find(s=>s.currency==='USD')!.values[0]).toBe('110');
    });
    it('rejects missing budgets and derived cycles instead of reporting partial results',()=>{
        const budget=q('b','budget');budget.budgetIds=['deleted'];expect(()=>buildExplorerComparison({...input,queries:[budget],facts:{}})).toThrow('недоступен');
        const d=q('d','difference');d.leftQueryId='d';d.rightQueryId='d';expect(()=>buildExplorerComparison({...input,queries:[d],facts:{}})).toThrow('исходных');
    });
    it('roundtrips and clones source settings; old queries remain actual',()=>{
        const query=q('p','forecast');query.accountIds=['a'];query.includeOptional=true;query.forecastMethod='pace';
        expect(TransactionExplorerQuery.parse(query.toJsonObject())!.toJsonObject()).toEqual(query.toJsonObject());
        const clone=query.clone('new');clone.budgetIds.push('new');expect(query.budgetIds).toEqual(['food']);
        expect(TransactionExplorerQuery.parse({id:'old',name:'old',conditions:[]})!.source).toBe('actual');
        expect(TransactionExplorerQuery.parse({...query.toJsonObject(),source:'sql'})).toBeNull();
        const explorer=InsightsExplorer.createNewExplorer('q');explorer.queries=[query];explorer.comparisonCumulative=false;explorer.comparisonChart='bar';explorer.comparisonCurrency='RUB';
        const parsed=InsightsExplorer.of({id:'x',name:'test',displayOrder:0,hidden:false,data:explorer.data});
        expect(parsed.data).toEqual(explorer.data);
        for (const chart of ['radar','custom'] as const) { explorer.comparisonChart=chart; expect(InsightsExplorer.of({id:'x',name:'test',displayOrder:0,hidden:false,data:explorer.data}).comparisonChart).toBe(chart); }
    });
});


it('exposes exact per-budget breakdown with query filters, dates and currencies',()=>{
    const mixed={...plan,budgets:[...plan.budgets,{...plan.budgets[0]!,id:'rent',name:'Жильё',categoryIds:['rent'],limit:'999999999999999'},{...plan.budgets[0]!,id:'usd',name:'USD',accountId:'b',categoryIds:['usd'],limit:'100'}]};
    const actual=q('a','actual'),budget=q('b','budget');actual.budgetIds=[];budget.budgetIds=[];
    const result=buildExplorerComparison({...input,plan:mixed,queries:[actual,budget],facts:{a:[fact('2026-11-01','373'),fact('2026-11-02','999999999999999',{categoryIds:['rent']}),fact('2026-11-21','999999999'),fact('2026-10-31','1000'),fact('2026-11-03','200',{categoryIds:['outside']}),fact('2026-11-01','10',{kind:2})]}});
    expect(result.series.find(s=>s.id==='a'&&s.currency==='RUB')!.budgets).toEqual([{id:'food',name:'Еда',total:'373'},{id:'rent',name:'Жильё',total:'999999999999999'}]);
    expect(result.series.find(s=>s.id==='b'&&s.currency==='RUB')!.budgets[1]!.total).toBe('999999999999999');
    expect(result.series.find(s=>s.id==='a'&&s.currency==='USD')!.budgets[0]!.total).toBe('0');
    actual.budgetIds=['food'];
    const filtered=buildExplorerComparison({...input,plan:mixed,queries:[actual],facts:{a:[fact('2026-11-01','373')]}});
    expect(filtered.series[0]!.budgets).toEqual([{id:'food',name:'Еда',total:'373'}]);
});
