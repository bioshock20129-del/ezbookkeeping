import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { displayMoney, toMinor, flatAccounts, parseFinancialPlan, planningRequest, formatPlanningMoney, monthlyBudgetTotals } from '../planning.ts';

describe('financial planning money and import', () => {
    it('uses decimal arithmetic and preserves all minor units', () => {
        expect(toMinor('3,73')).toBe('373');
        expect(toMinor('9999999999999.99')).toBe('999999999999999');
        expect(displayMoney('11811740')).toBe('118117.40');
        for (const invalid of ['NaN', '-1', '1.001', '10000000000000']) expect(() => toMinor(invalid)).toThrow();
    });
    it('keeps group labels but excludes empty group accounts', () => {
        expect(flatAccounts([{id:'g',name:'Bank',type:2,currency:'RUB',balance:'0',subAccounts:[{id:'a',name:'Card',currency:'RUB',balance:'1'}]}, {id:'empty',name:'Empty',type:2,currency:'RUB',balance:'0'}])).toEqual([{id:'a',name:'Bank / Card',currency:'RUB',balance:'1'}]);
    });
    it('restores only well-formed editable data and keeps the current revision', () => {
        const p={revision:99,budgets:[{id:'b',name:'Food',accountId:'a',categoryIds:['c'],limit:'100',estimate:false}],items:[]};
        expect(parseFinancialPlan(JSON.stringify(p), 4).revision).toBe(4);
        expect(() => parseFinancialPlan('{"budgets":[],"items":[{}]}',4)).toThrow();
        if(p.budgets[0]) p.budgets[0].limit='NaN';
        expect(() => parseFinancialPlan(JSON.stringify(p),4)).toThrow();
    });
});


describe('planning API version contract', () => {
    it('uses v1 routes under the shared /api base for reads and preview', async () => {
        const get = vi.spyOn(axios, 'get').mockResolvedValue({data:{success:true,result:{revision:1}}});
        const post = vi.spyOn(axios, 'post').mockResolvedValue({data:{success:true,result:{points:[]}}});
        await planningRequest('planning/get.json');
        await planningRequest('accounts/list.json');
        await planningRequest('transaction/categories/list.json');
        const request={through:'2026-12-01',includeOptional:false};
        await planningRequest('planning/preview.json',request);
        expect(get.mock.calls.map(call=>call[0])).toEqual(['v1/planning/get.json','v1/accounts/list.json','v1/transaction/categories/list.json']);
        expect(post).toHaveBeenCalledWith('v1/planning/preview.json', request);
    });
});


describe('planning display amounts', () => {
    it('groups exact minor-unit values without binary floating point', () => {
        expect(formatPlanningMoney('11811740','RUB')).toBe('118\u00a0117,40 ₽');
        expect(formatPlanningMoney('2500000','RUB')).toBe('25\u00a0000 ₽');
        expect(formatPlanningMoney('-12345','USD')).toBe('−123,45 $');
        expect(formatPlanningMoney('999999999999999','RUB')).toBe('9\u00a0999\u00a0999\u00a0999\u00a0999,99 ₽');
    });
});


describe('monthly budget totals', () => {
    const account=(id:string,currency:string)=>({id,currency,name:id,balance:'0'});
    const budget=(id:string,accountId:string,limit:string)=>({id,name:id,accountId,limit,categoryIds:['c'],estimate:false});
    it('totals the four monthly limits, without combining currencies', () => {
        const budgets=[budget('base','a','6000000'),budget('education','a','1500000'),budget('leisure','a','2000000'),budget('gifts','a','1000000'),budget('usd','b','12345')];
        const totals=monthlyBudgetTotals(budgets,[account('a','RUB'),account('b','USD')]);
        expect(totals.map(t=>[t.currency,t.limit,t.spent])).toEqual([['RUB','10500000',null],['USD','12345',null]]);
        expect(formatPlanningMoney(totals[0]!.limit,'RUB')).toBe('105\u00a0000 ₽');
    });
    it('preserves cents past Number precision and negative remaining amounts', () => {
        const budgets=[budget('a','a','999999999999999'),budget('b','a','999999999999999')];
        const reports=budgets.map(b=>({...b,currency:'RUB',spent:'999999999999999',committed:'1',remaining:'-1',estimated:'0'}));
        expect(monthlyBudgetTotals(budgets,[account('a','RUB')],reports)).toEqual([{currency:'RUB',limit:'1999999999999998',spent:'1999999999999998',committed:'2',remaining:'-2'}]);
        expect(monthlyBudgetTotals(budgets,[account('a','RUB')],reports.slice(0,1))[0]!.spent).toBeNull();
    });
    it('keeps unresolved draft accounts out of known-currency totals', () => {
        expect(monthlyBudgetTotals([budget('draft','','100')],[])).toEqual([{currency:'',limit:'100',spent:null,committed:null,remaining:null}]);
    });
});
