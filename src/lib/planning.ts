import axios from 'axios';
import Decimal from 'decimal.js';

export interface PlanningBudget { id: string; name: string; accountId: string; categoryIds: string[]; limit: string; estimate: boolean }
export interface PlanningItem { id: string; name: string; kind: string; accountId: string; destinationId: string; budgetId: string; amount: string; date: string; frequency: string; endDate: string; optional: boolean; skipDates: string[] }
export interface FinancialPlan { revision: number; budgets: PlanningBudget[]; items: PlanningItem[] }
export interface PlanningAccount { id: string; name: string; currency: string; balance: string; isLiability?: boolean; type?: number; subAccounts?: PlanningAccount[] }
export interface PlanningCategory { id: string; name: string; subCategories?: PlanningCategory[] }
export interface BudgetReport { id: string; name: string; currency: string; limit: string; spent: string; committed: string; estimated: string; remaining: string }
export interface ForecastEvent { id: string; name: string; date: string; accountId: string; budgetId: string; amount: string; source: string }
export interface ForecastResult { asOf: string; through: string; budgets: BudgetReport[]; accounts: PlanningAccount[]; events: ForecastEvent[]; points: {date: string; accountId: string; balance: string}[]; minimum: Record<string, string> }
export async function planningRequest<T>(path: string, body?: unknown): Promise<T> {
    try {
        const response = body === undefined ? await axios.get('v1/' + path) : await axios.post('v1/' + path, body);
        if (!response.data.success) throw new Error(response.data.errorMessage || 'Не удалось выполнить запрос');
        return response.data.result as T;
    } catch (error) {
        if (axios.isAxiosError(error) && typeof error.response?.data?.errorMessage === 'string') throw new Error(error.response.data.errorMessage);
        throw error;
    }
}
export function toMinor(value: string): string {
    try {
        const amount = new Decimal(value.trim().replace(',', '.')).mul(100);
        if (!amount.isFinite() || !amount.isInteger() || amount.lt(0) || amount.gt('999999999999999')) throw new Error('invalid amount');
        return amount.toFixed(0);
    } catch { throw new Error('Введите сумму с точностью до копейки'); }
}
export function displayMoney(value: string): string { return new Decimal(value).div(100).toFixed(2); }
export function formatPlanningMoney(minor: string, currency: string): string {
    const [integer, fraction] = displayMoney(minor).split('.');
    const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0').replace(/^-/, '−');
    const symbol = ({RUB:'₽',USD:'$',EUR:'€'} as Record<string,string>)[currency] || currency;
    return `${grouped}${fraction === '00' ? '' : ',' + fraction}${symbol ? ' ' + symbol : ''}`;
}

export function flatAccounts(items: PlanningAccount[]): PlanningAccount[] { return items.flatMap(a => a.subAccounts?.length ? flatAccounts(a.subAccounts).map(child => ({...child, name: `${a.name} / ${child.name}`})) : a.type === 2 ? [] : [a]); }

export function parseFinancialPlan(source: string, revision: number): FinancialPlan {
    const value = JSON.parse(source);
    const str = (v: unknown) => typeof v === 'string';
    const amount = (v: unknown) => str(v) && /^[0-9]{1,15}$/.test(v as string);
    if (!value || !Array.isArray(value.budgets) || !Array.isArray(value.items) || value.budgets.length > 100 || value.items.length > 500) throw new Error('Неверный формат плана');
    for (const b of value.budgets) {
        if (!b || !str(b.id) || !str(b.name) || !str(b.accountId) || !Array.isArray(b.categoryIds) || !b.categoryIds.every(str) || !amount(b.limit) || typeof b.estimate !== 'boolean') throw new Error('Некорректный бюджет в файле');
    }
    for (const i of value.items) {
        if (!i || !['id','name','kind','accountId','destinationId','budgetId','date','frequency','endDate'].every(k => str(i[k])) || !amount(i.amount) || typeof i.optional !== 'boolean' || !Array.isArray(i.skipDates) || !i.skipDates.every(str)) throw new Error('Некорректный платёж в файле');
    }
    return {revision, budgets:value.budgets, items:value.items};
}
