/** Runs unchanged in the existing CustomChart iframe and can be edited/saved in an exploration. */
export const budgetRadarScript = String.raw`// Бюджеты — оси; пунктир — план, сплошная линия — факт.
// Выберите полный месяц, чтобы сравнить факт с полным месячным лимитом.
/** @param {CustomChartTransaction[]} transactions
 *  @param {CustomChartComparison} comparison */
function buildChartOptions(transactions, comparison) {
    if (!comparison) throw new Error('Добавьте запросы с источниками «Бюджет» и «Операции (факт)».');
    const currency = comparison.currency;
    const groups = { budget: new Map(), actual: new Map() };
    for (const series of comparison.series) {
        if (series.currency !== currency || !groups[series.source] || series.flow !== 'expense') continue;
        if (series.source === 'actual' && series.daily.every(value => value === null)) continue;
        for (const budget of series.budgets) {
            const previous = groups[series.source].get(budget.id);
            if (previous && previous.total !== budget.total) {
                throw new Error('Разные условия для бюджета «' + budget.name + '». Оставьте один запрос каждого источника для этого бюджета.');
            }
            groups[series.source].set(budget.id, budget);
        }
    }
    const budgets = Array.from(groups.budget.values());
    if (budgets.length < 3) throw new Error('Для радарной диаграммы выберите не менее трёх бюджетов одной валюты в запросе «Бюджет».');
    if (budgets.some(b => !groups.actual.has(b.id))) throw new Error('Добавьте запрос «Операции (факт)» с теми же бюджетами, показателем «Расходы» и периодом, включающим прошедшие даты.');
    const planned = budgets.map(b => Number(b.total) / 100);
    const actual = budgets.map(b => Number(groups.actual.get(b.id).total) / 100);
    // Одинаковая денежная шкала на всех осях. Только отображение использует Number.
    const max = Math.max(1, ...planned, ...actual) * 1.1;
    return {
        animation: false,
        color: ['#d8a45e', '#60a5fa'],
        tooltip: { trigger: 'item', confine: true, renderMode: 'richText' },
        legend: { bottom: 12, textStyle: { color: '#999' } },
        radar: {
            center: ['50%', '48%'], radius: '58%',
            indicator: budgets.map(b => ({ name: b.name + ' (' + currency + ')', min: 0, max })),
            axisName: { color: '#999', width: 120, overflow: 'break' },
            splitArea: { show: false }, splitLine: { lineStyle: { color: '#8884' } }
        },
        series: [{ type: 'radar', data: [
            { name: 'План · ' + currency, value: planned, symbol: 'none', lineStyle: { type: 'dashed', width: 2 }, areaStyle: { opacity: 0 } },
            { name: 'Факт · ' + currency, value: actual, symbol: 'circle', lineStyle: { type: 'solid', width: 2 }, areaStyle: { opacity: 0.08 } }
        ] }]
    };
}`;
