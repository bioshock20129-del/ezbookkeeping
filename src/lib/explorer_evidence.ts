import Decimal from 'decimal.js';
import type { ExplorerComparison, ExplorerContribution } from './explorer_sources.ts';

export function comparisonTransactions(comparison: ExplorerComparison, queryId: string, currency: string, budgetId = ''): ExplorerContribution[] {
    const transactions = comparison.evidence.find(item => item.queryId === queryId && item.currency === currency)?.transactions || [];
    return transactions.filter(item => !budgetId || item.budgetIds.includes(budgetId));
}

export function contributionTotal(transactions: ExplorerContribution[]): string {
    return transactions.reduce((sum, item) => sum.add(item.amount), new Decimal(0)).toFixed(0);
}

export function contributionsByCategory(transactions: ExplorerContribution[]): {id: string; name: string; amount: string; count: number}[] {
    const categories = new Map<string, {id: string; name: string; amount: string; count: number}>();
    for (const item of transactions) {
        const id = item.categoryId || item.categoryName;
        const category = categories.get(id) || {id, name:item.categoryName, amount:'0', count:0};
        category.amount = new Decimal(category.amount).add(item.amount).toFixed(0);
        category.count++;
        categories.set(id, category);
    }
    return [...categories.values()].sort((a, b) => new Decimal(b.amount).comparedTo(a.amount));
}

export function contributionCSV(transactions: ExplorerContribution[], currency: string): string {
    const cell = (value: string) => '"' + (/^[\s]*[=+@\-]/.test(value) && !/^-[0-9]+(?:\.[0-9]+)?$/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
    const kind = (value: number) => ({2:'Доход', 3:'Расход', 4:'Перевод'} as Record<number,string>)[value] || 'Операция';
    return '\uFEFF' + [
        ['ID транзакции', 'Дата', 'Тип', 'Категория', 'Счёт', 'Комментарий', 'Валюта', 'Сумма в расчёте'],
        ...transactions.map(item => [item.transactionId, item.date, kind(item.kind), item.categoryName, item.accountName, item.comment, currency, item.hideAmount ? '***' : new Decimal(item.amount).div(100).toFixed(2)])
    ].map(row => row.map(cell).join(';')).join('\r\n');
}
