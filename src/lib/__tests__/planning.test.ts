import { describe, expect, it } from 'vitest';
import { displayMoney, toMinor, flatAccounts, parseFinancialPlan } from '../planning.ts';

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
