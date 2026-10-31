import Decimal from 'decimal.js';
import type { TransactionExplorerQuery } from '@/models/explorer.ts';
import type { FinancialPlan, ForecastResult, PlanningBudget } from '@/lib/planning.ts';
export interface ExplorerFact {
    id: string;
    date: string;
    time: number;
    kind: number;
    accountId: string;
    destinationId: string;
    currency: string;
    destinationCurrency: string;
    amount: string;
    destinationAmount: string;
    categoryIds: string[];
}
export interface ExplorerSeries {
    id: string;
    name: string;
    source: string;
    currency: string;
    daily: (string | null)[];
    values: (string | null)[];
}
export interface ExplorerComparison {
    dates: string[];
    currencies: string[];
    series: ExplorerSeries[];
}
const dayMS = 86400000;
export function calendarDays(start: string, end: string): string[] {
    const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || (b - a) / dayMS > 365)
        throw new Error('Выберите период от 1 до 366 дней.');
    return Array.from({ length: Math.round((b - a) / dayMS) + 1 }, (_, i) => new Date(a + i * dayMS).toISOString().slice(0, 10));
}
export function budgetDayAmount(limit: string, date: string): string {
    const parts = date.split('-').map(Number), d = parts[2] || 1;
    const days = new Date(Date.UTC(parts[0] || 0, parts[1] || 1, 0)).getUTCDate();
    const value = new Decimal(limit), base = value.div(days).floor(), extra = value.mod(days).toNumber();
    return base.add(d <= extra ? 1 : 0).toFixed(0);
}
function selectedBudget(q: TransactionExplorerQuery, plan: FinancialPlan): PlanningBudget[] {
    const budgets = q.budgetIds.length ? plan.budgets.filter(b => q.budgetIds.includes(b.id)) : plan.budgets;
    if (q.budgetIds.some(id => !plan.budgets.some(b => b.id === id)))
        throw new Error(`«${q.name}»: бюджет удалён или недоступен.`);
    return budgets.filter(b => !q.accountIds.length || q.accountIds.includes(b.accountId));
}
export function buildExplorerComparison(args: {
    queries: TransactionExplorerQuery[];
    // Ordinary query conditions have already been applied to actual facts by the store.
    facts: Record<string, ExplorerFact[]>;
    plan: FinancialPlan;
    accounts: Record<string, {
        currency: string;
    }>;
    forecasts: Record<string, ForecastResult>;
    start: string;
    end: string;
    today: string;
    now: number;
    cumulative: boolean;
}): ExplorerComparison {
    const { queries, facts, plan, accounts, forecasts, start, end, today, now, cumulative } = args;
    if (queries.length > 50 || new Set(queries.map(q => q.id)).size !== queries.length)
        throw new Error('До 50 запросов с уникальными ID.');
    const dates = calendarDays(start, end), series: ExplorerSeries[] = [];
    for (const q of queries.filter(q => q.source !== 'difference')) {
        const budgets = selectedBudget(q, plan), bids = new Set(budgets.map(b => b.id));
        const amounts = new Map<string, Map<string, Decimal>>();
        const add = (currency: string, date: string, amount: Decimal.Value) => {
            if (date < start || date > end) return;
            let byDay = amounts.get(currency);
            if (!byDay) {
                byDay = new Map();
                amounts.set(currency, byDay);
            }
            byDay.set(date, (byDay.get(date) || new Decimal(0)).add(amount));
        };
        const accountSelected = (id: string) => !q.accountIds.length || q.accountIds.includes(id);
        const factSelected = (f: ExplorerFact) => !q.budgetIds.length || budgets.some(b => b.accountId === f.accountId && b.categoryIds.some(id => f.categoryIds.includes(id)));
        const addFacts = () => {
            for (const f of facts[q.id] || []) {
                if (f.time > now || !factSelected(f))
                    continue;
                if (f.kind === 3 && q.flow !== 'income' && accountSelected(f.accountId))
                    add(f.currency, f.date, q.flow === 'net' ? new Decimal(f.amount).neg() : f.amount);
                if (f.kind === 2 && q.flow !== 'expense' && accountSelected(f.accountId))
                    add(f.currency, f.date, f.amount);
                if (f.kind === 4 && q.flow === 'net' && !q.budgetIds.length) {
                    if (accountSelected(f.accountId))
                        add(f.currency, f.date, new Decimal(f.amount).neg());
                    if (accountSelected(f.destinationId))
                        add(f.destinationCurrency, f.date, f.destinationAmount);
                }
            }
        };
        if (q.source === 'budget') {
            if (!budgets.length)
                throw new Error(`«${q.name}»: выберите доступный бюджет.`);
            for (const b of budgets) {
                const account = accounts[b.accountId];
                if (!account)
                    throw new Error('Счёт бюджета недоступен.');
                for (const date of dates)
                    add(account.currency, date, budgetDayAmount(b.limit, date));
            }
        }
        else {
            addFacts();
            // Preview contains future events only; past recorded facts above are added once.
            if (q.source === 'forecast' && end >= today) {
                if (q.forecastMethod === 'pace') {
                    if (q.flow !== 'expense')
                        throw new Error('Прогноз по темпу доступен только для расходов.');
                    if (start > today)
                        throw new Error('Для оценки темпа нужен факт с начала выбранного периода.');
                    const elapsed = calendarDays(start, today).length;
                    if (amounts.size === 0)
                        throw new Error(`«${q.name}»: нет фактических расходов для оценки темпа.`);
                    for (const [currency, days] of amounts) {
                        const total = Array.from(days.values()).reduce((a, b) => a.add(b), new Decimal(0));
                        let n = 0;
                        for (const date of dates.filter(d => d > today)) {
                            n++;
                            const previous = total.mul(n - 1).div(elapsed).floor(), next = total.mul(n).div(elapsed).floor();
                            add(currency, date, next.sub(previous));
                        }
                    }
                }
                else {
                    const preview = forecasts[q.includeOptional ? 'optional' : 'required'];
                    if (!preview)
                        throw new Error('Прогноз ещё не загружен.');
                    for (const e of preview.events) {
                        if (!['expense', 'income', 'transfer', 'adjustment'].includes(e.kind))
                            throw new Error('Обновите сервер: в прогнозе отсутствует тип события.');
                        if (!accountSelected(e.accountId) || (q.budgetIds.length && !bids.has(e.budgetId)))
                            continue;
                        const account = accounts[e.accountId];
                        if (!account)
                            throw new Error('Счёт прогноза недоступен.');
                        if (e.kind === 'adjustment' || (e.kind === 'transfer' && q.flow !== 'net'))
                            continue;
                        const amount = new Decimal(e.amount);
                        if (q.flow === 'expense' && e.kind === 'expense')
                            add(account.currency, e.date, amount.neg());
                        else if (q.flow === 'income' && e.kind === 'income')
                            add(account.currency, e.date, amount);
                        else if (q.flow === 'net')
                            add(account.currency, e.date, amount);
                    }
                }
            }
        }
        // Keep zero series in the selected accounts/budgets even without matching facts.
        for (const id of q.accountIds) {
            if (accounts[id] && !amounts.has(accounts[id]!.currency))
                amounts.set(accounts[id]!.currency, new Map());
        }
        for (const b of budgets) {
            if (q.budgetIds.length || q.source === 'budget') {
                const currency = accounts[b.accountId]?.currency;
                if (currency && !amounts.has(currency))
                    amounts.set(currency, new Map());
            }
        }
        if (amounts.size === 0 && q.source !== 'budget')
            for (const account of Object.values(accounts))
                if (!amounts.has(account.currency))
                    amounts.set(account.currency, new Map());
        for (const [currency, byDay] of amounts) {
            let sum = new Decimal(0);
            const daily = dates.map(d => q.source === 'actual' && d > today ? null : (byDay.get(d) || new Decimal(0)).toFixed(0));
            const values = daily.map(value => { if (value === null)
                return null; sum = sum.add(value); return cumulative ? sum.toFixed(0) : value; });
            series.push({ id: q.id, name: q.name || 'Без названия', source: q.source, currency, daily, values });
        }
    }
    for (const q of queries.filter(q => q.source === 'difference')) {
        const left = queries.find(v => v.id === q.leftQueryId), right = queries.find(v => v.id === q.rightQueryId);
        if (!left || !right || left.source === 'difference' || right.source === 'difference')
            throw new Error(`«${q.name}»: выберите два исходных запроса, без вложенных разниц.`);
        const currencies = new Set(series.filter(s => s.id === left.id || s.id === right.id).map(s => s.currency));
        for (const currency of currencies) {
            const a = series.find(s => s.id === left.id && s.currency === currency), b = series.find(s => s.id === right.id && s.currency === currency);
            if (!a || !b)
                continue;
            const subtract = (x: (string | null)[], y: (string | null)[]) => x.map((v, i) => v === null || y[i] === null ? null : new Decimal(v).sub(y[i] || 0).toFixed(0));
            series.push({ id: q.id, name: q.name || 'Разница', source: q.source, currency, daily: subtract(a.daily, b.daily), values: subtract(a.values, b.values) });
        }
    }
    return { dates, currencies: Array.from(new Set(series.map(s => s.currency))).sort(), series };
}
