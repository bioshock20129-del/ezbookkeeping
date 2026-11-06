import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { TransactionExplorerQuery } from '@/models/explorer.ts';
import { buildExplorerComparison, type ExplorerFact } from '../explorer_sources.ts';
import { comparisonTransactions, contributionTotal, contributionsByCategory, contributionCSV } from '../explorer_evidence.ts';

const query = (id:string, source:TransactionExplorerQuery['source'] = 'actual') => {const q=TransactionExplorerQuery.create(id);q.source=source;return q;};
const fact = (id:string, amount:string, overrides:Partial<ExplorerFact> = {}):ExplorerFact => ({
    id,amount,date:'2026-11-04',time:Date.parse('2026-11-04T12:00:00Z')/1000,kind:3,accountId:'a',destinationId:'b',currency:'RUB',destinationCurrency:'USD',destinationAmount:amount,categoryIds:['housing','rent'],categoryName:'Жильё / Аренда',accountName:'Сбер',destinationAccountName:'USD',comment:'Обязательный платёж',...overrides
});
const base = {
    plan:{revision:1,items:[],budgets:[{id:'base',name:'Базовые расходы',accountId:'a',categoryIds:['housing','rent'],limit:'6000000',estimate:false}]},
    accounts:{a:{currency:'RUB'},b:{currency:'USD'}},forecasts:{},start:'2026-11-01',end:'2026-11-30',today:'2026-11-06',now:Date.parse('2026-11-06T10:00:00Z')/1000,cumulative:true
};

describe('transaction evidence from the exact comparison calculation', () => {
    it('reconciles a budget with its graph and exposes the 20,559.10 RUB overspend', () => {
        const q=query('actual');q.budgetIds=['base'];
        const result=buildExplorerComparison({...base,queries:[q],facts:{actual:[
            fact('rent','6000000'),fact('utility','2055910',{categoryIds:['housing','utility'],categoryName:'Жильё / Коммунальные',comment:'Коммунальные услуги'}),
            fact('outside','999999',{categoryIds:['leisure']}),fact('other-bank','999999',{accountId:'b',currency:'USD'}),
            fact('income','999999',{kind:2}),fact('transfer','999999',{kind:4}),
            fact('future-date','999999',{date:'2026-11-07',time:Date.parse('2026-11-07')/1000}),
            fact('later-today','999999',{date:base.today,time:base.now+1}),fact('outside-period','999999',{date:'2026-10-31',time:Date.parse('2026-10-31')/1000})
        ]}});
        const rows=comparisonTransactions(result,q.id,'RUB','base');
        expect(rows.map(r=>r.transactionId)).toEqual(['rent','utility']);
        expect(contributionTotal(rows)).toBe('8055910');
        expect(result.series[0]!.budgets[0]!.total).toBe(contributionTotal(rows));
        expect(result.series[0]!.values[5]).toBe(contributionTotal(rows));
        expect(new Decimal(contributionTotal(rows)).sub(base.plan.budgets[0]!.limit).toString()).toBe('2055910');
        expect(rows[0]).toMatchObject({categoryName:'Жильё / Аренда',accountName:'Сбер',comment:'Обязательный платёж',budgetIds:['base']});
        // Matching both the primary and secondary category still counts each transaction once.
        expect(rows[0]!.amount).toBe('6000000');
        expect(contributionsByCategory(rows).map(c=>[c.name,c.amount])).toEqual([['Жильё / Аренда','6000000'],['Жильё / Коммунальные','2055910']]);
    });
    it('separates currencies and unbudgeted expenses, retaining the original query scope', () => {
        const a=query('all'),filtered=query('filtered');
        const recorded=[fact('rent','373'),fact('unbudgeted','100',{categoryIds:['food']}),fact('usd','250',{accountId:'b',currency:'USD',categoryIds:['food']})];
        const result=buildExplorerComparison({...base,queries:[a,filtered],facts:{all:recorded,filtered:[recorded[0]!]}});
        expect(contributionTotal(comparisonTransactions(result,'all','RUB'))).toBe('473');
        expect(contributionTotal(comparisonTransactions(result,'all','RUB','base'))).toBe('373');
        expect(contributionTotal(comparisonTransactions(result,'all','USD'))).toBe('250');
        expect(contributionTotal(comparisonTransactions(result,'filtered','RUB','base'))).toBe('373');
        expect(comparisonTransactions(result,'missing','RUB')).toEqual([]);
    });
    it('keeps signed transfer legs on their selected accounts for cashflow, with exact totals', () => {
        const q=query('net');q.flow='net';
        const result=buildExplorerComparison({...base,queries:[q],facts:{net:[fact('transfer','1000',{kind:4,destinationCurrency:'RUB'}),fact('income','1500',{kind:2})]},accounts:{a:{currency:'RUB'},b:{currency:'RUB'}}});
        const rows=comparisonTransactions(result,'net','RUB');
        expect(rows.map(r=>[r.transactionId,r.accountId,r.amount])).toEqual([['transfer','a','-1000'],['transfer','b','1000'],['income','a','1500']]);
        expect(contributionTotal(rows)).toBe('1500');
        expect(result.series[0]!.values[5]).toBe('1500');
    });
    it('does not invent recorded transactions for budget or forecast estimates', () => {
        const budget=query('budget','budget'),forecast=query('forecast','forecast');
        const result=buildExplorerComparison({...base,queries:[budget,forecast],facts:{},forecasts:{required:{asOf:'2026-11-06T10:00:00Z',through:base.end,budgets:[],accounts:[],points:[],minimum:{},events:[{id:'planned',name:'План',kind:'expense',source:'planned',date:'2026-11-10',accountId:'a',budgetId:'base',amount:'-500'}]}}});
        expect(result.evidence).toEqual([]);
        expect(result.series.find(s=>s.id==='forecast')!.values.at(-1)).toBe('500');
    });
    it('keeps cents in category totals and exports only the chosen rows with escaped comments', () => {
        const q=query('actual');
        const result=buildExplorerComparison({...base,queries:[q],facts:{actual:[fact('one','999999999999999',{comment:'=HYPERLINK("url")'}),fact('two','999999999999999',{comment:'Обед\nи чай'})]}});
        const rows=comparisonTransactions(result,'actual','RUB','base');
        expect(contributionsByCategory(rows)[0]).toMatchObject({amount:'1999999999999998',count:2});
        const csv=contributionCSV(rows.slice(0,1),'RUB');
        expect(csv).toContain('"9999999999999.99"');
        expect(csv).toContain('"\'=HYPERLINK(""url"")"');
        expect(csv).not.toContain('Обед');
    });
});


it('keeps hidden amounts in calculation totals while respecting the ledger display flag in CSV', () => {
    const result=buildExplorerComparison({...base,queries:[query('q')],facts:{q:[fact('hidden','12345',{hideAmount:true})]}});
    const rows=comparisonTransactions(result,'q','RUB');
    expect(contributionTotal(rows)).toBe('12345');
    expect(rows[0]!.hideAmount).toBe(true);
    expect(contributionCSV(rows,'RUB')).toContain('"***"');
    expect(contributionCSV(rows,'RUB')).not.toContain('123.45');
});
