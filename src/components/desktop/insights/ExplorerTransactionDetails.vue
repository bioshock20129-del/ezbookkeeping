<template>
    <v-dialog v-model="shown" max-width="1240" scrollable>
        <v-card rounded="lg" class="transaction-evidence">
            <v-card-title class="d-flex align-center justify-space-between pa-5">
                <span>Транзакции в расчёте</span>
                <v-btn icon variant="text" aria-label="Закрыть расшифровку" @click="shown = false"><v-icon :icon="mdiClose" /></v-btn>
            </v-card-title>
            <v-card-text class="pt-2">
                <div class="evidence-controls">
                    <v-select label="Запрос факта" :items="queryOptions" item-title="title" item-value="value" v-model="queryId" hide-details />
                    <v-select label="Бюджет" :items="budgetOptions" item-title="title" item-value="value" v-model="budgetId" hide-details />
                </div>
                <p class="text-body-medium text-medium-emphasis mt-4 mb-2">{{ dateLabel(comparison.dates[0] || '') }} — {{ dateLabel(comparison.dates.at(-1) || '') }} · {{ currency }} · факт на момент расчёта.</p>
                <p class="text-body-small text-medium-emphasis mb-2">Список учитывает период, счета, бюджеты и условия выбранного запроса. В списке — записанные операции до момента расчёта. В показателе «Расходы» доходы и переводы не участвуют.</p>
                <p v-if="series?.flow === 'net'" class="text-body-small mb-2">Для переводов показаны вклады выбранных счетов: списание со знаком минус, зачисление со знаком плюс.</p>
                <p v-if="transactions.some(item => item.hideAmount)" class="text-body-small mb-2">Скрытые суммы участвуют в итогах; в списке и CSV они показаны как ***.</p>
                <p v-if="budget" class="text-body-small mb-4">{{ budgetRule }}</p>
                <div class="evidence-totals my-4">
                    <div><span>Факт в расчёте</span><strong>{{ money(actualTotal) }}</strong><small>Транзакций: {{ transactionCount }}</small></div>
                    <div v-if="periodLimit !== null"><span>План за выбранный период</span><strong>{{ money(periodLimit) }}</strong><small>В полном месяце — месячный лимит</small></div>
                    <div v-if="deviation !== null"><span>{{ new Decimal(deviation).gt(0) ? 'Перерасход' : 'Остаток плана' }}</span><strong :class="{ 'text-error':new Decimal(deviation).gt(0) }">{{ money(new Decimal(deviation).abs().toFixed(0)) }}</strong></div>
                </div>
                <v-alert v-if="!reconciled" type="error" variant="tonal" class="mb-4">Сумма списка не совпадает с расчётом. Обновите данные исследования перед проверкой операций.</v-alert>
                <template v-if="categories.length">
                    <h3 class="text-title-medium mb-2">Из чего сложилась сумма</h3>
                    <v-table density="compact" :height="Math.min(220, 40 + categories.length * 44)" fixed-header class="evidence-categories mb-5">
                        <thead><tr><th>Категория</th><th class="text-end">Записей</th><th class="text-end">Сумма</th></tr></thead>
                        <tbody><tr v-for="category in categories" :key="category.id"><td>{{ category.name }}</td><td class="text-end">{{ category.count }}</td><td class="text-end evidence-amount">{{ money(category.amount) }}</td></tr></tbody>
                    </v-table>
                </template>
                <div class="evidence-actions mb-3">
                    <v-text-field v-model="search" label="Поиск по категории, счёту, комментарию или ID" clearable hide-details :prepend-inner-icon="mdiMagnify" />
                    <v-btn variant="outlined" :disabled="!filtered.length || !reconciled" @click="download">Скачать транзакции CSV</v-btn>
                </div>
                <p class="text-body-small mb-2 evidence-filter-total">Строк по поиску: {{ filtered.length }} из {{ transactions.length }} · {{ money(contributionTotal(filtered)) }} (все страницы)</p>
                <v-data-table class="evidence-transactions" :headers="headers" :items="rows" v-model:items-per-page="itemsPerPage" :items-per-page-options="[10,25,50]"
                              item-value="index" :sort-by="[{key:'time',order:'desc'}]" fixed-header :height="Math.min(400, Math.max(156, 56 + Math.min(itemsPerPage, filtered.length) * 52))" v-model:page="page" no-data-text="Подходящих транзакций нет"
                              items-per-page-text="Строк на странице" :page-text="pageSummary" first-page-label="Первая страница" prev-page-label="Предыдущая страница" next-page-label="Следующая страница" last-page-label="Последняя страница">
                    <template #item.time="{ item }">{{ dateLabel(item.date) }}</template>
                    <template #item.budgets="{ item }">{{ item.budgetIds.map(id => plan.budgets.find(b => b.id === id)?.name || id).join(', ') || 'Вне бюджетов' }}</template>
                    <template #item.amount="{ item }"><span class="evidence-amount">{{ item.hideAmount ? '***' : money(item.amount) }}</span></template>
                    <template #item.actions="{ item }"><v-btn variant="text" size="small" @click="openTransaction(item.transactionId)" :aria-label="'Открыть транзакцию ' + item.transactionId">Открыть</v-btn></template>
                </v-data-table>
            </v-card-text>
            <v-card-actions class="pa-4"><v-spacer /><v-btn @click="shown = false">Закрыть</v-btn></v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Decimal from 'decimal.js';
import { mdiClose, mdiMagnify } from '@mdi/js';
import { useAccountsStore } from '@/stores/account.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import type { TransactionExplorerQuery } from '@/models/explorer.ts';
import type { FinancialPlan } from '@/lib/planning.ts';
import { formatPlanningMoney } from '@/lib/planning.ts';
import { budgetDayAmount, type ExplorerComparison } from '@/lib/explorer_sources.ts';
import { comparisonTransactions, contributionTotal, contributionsByCategory, contributionCSV } from '@/lib/explorer_evidence.ts';

const props = defineProps<{comparison:ExplorerComparison; plan:FinancialPlan; queries:TransactionExplorerQuery[]; currency:string}>();
const emit = defineEmits<{ 'click:transaction':[id:string] }>();
const accounts = useAccountsStore(), categoryStore = useTransactionCategoriesStore();
const shown = ref(false), queryId = ref(''), budgetId = ref(''), search = ref<string|null>(''), page = ref(1), itemsPerPage = ref(10);
const queryOptions = computed(() => props.queries.map((q, index) => ({q, index})).filter(({q}) => q.source === 'actual' && props.comparison.series.some(s => s.id === q.id && s.currency === props.currency && s.daily.some(v => v !== null))).map(({q,index}) => ({title:q.name || 'Запрос ' + (index + 1), value:q.id})));
const series = computed(() => props.comparison.series.find(s => s.id === queryId.value && s.currency === props.currency && s.source === 'actual'));
const budgetOptions = computed(() => [{title:'Все операции запроса',value:''}, ...(series.value?.budgets || []).map(b => ({title:b.name,value:b.id}))]);
const budget = computed(() => props.plan.budgets.find(b => b.id === budgetId.value));
const transactions = computed(() => comparisonTransactions(props.comparison,queryId.value,props.currency,budgetId.value));
const transactionCount = computed(() => new Set(transactions.value.map(item => item.transactionId)).size);
const actualTotal = computed(() => contributionTotal(transactions.value));
const expectedTotal = computed(() => budgetId.value ? series.value?.budgets.find(b => b.id === budgetId.value)?.total : series.value?.daily.reduce((sum,v) => v === null ? sum : sum.add(v),new Decimal(0)).toFixed(0));
const reconciled = computed(() => expectedTotal.value !== undefined && new Decimal(actualTotal.value).eq(expectedTotal.value));
const periodLimit = computed(() => budget.value ? props.comparison.dates.reduce((sum,date) => sum.add(budgetDayAmount(budget.value!.limit,date)),new Decimal(0)).toFixed(0) : null);
const deviation = computed(() => periodLimit.value === null ? null : new Decimal(actualTotal.value).sub(periodLimit.value).toFixed(0));
const categories = computed(() => contributionsByCategory(transactions.value));
const budgetRule = computed(() => {
    if (!budget.value) return '';
    const account = accounts.allAccountsMap[budget.value.accountId]?.name || budget.value.accountId;
    const names = budget.value.categoryIds.map(id => categoryStore.allTransactionCategoriesMap[id]?.name || id).join(', ');
    return `Бюджет «${budget.value.name}»: счёт ${account}; категории ${names} и их подкатегории.`;
});
const filtered = computed(() => {
    const term = (search.value || '').trim().toLocaleLowerCase();
    return transactions.value.filter(item => !term || [item.transactionId,item.categoryName,item.accountName,item.comment].some(v => v.toLocaleLowerCase().includes(term)));
});
const rows = computed(() => filtered.value.map((item,index) => ({...item,index})));
const pageSummary = computed(() => filtered.value.length ? `${Math.min((page.value - 1) * itemsPerPage.value + 1,filtered.value.length)}–${Math.min(page.value * itemsPerPage.value,filtered.value.length)} из ${filtered.value.length}` : '0 из 0');
const headers = [
    {title:'Дата',key:'time'}, {title:'Категория',key:'categoryName'}, {title:'Счёт',key:'accountName'},
    {title:'Бюджет',key:'budgets',sortable:false}, {title:'Комментарий',key:'comment'},
    {title:'Сумма в расчёте',key:'amount',align:'end' as const,sort:(a:string,b:string) => new Decimal(a).comparedTo(b)},
    {title:'',key:'actions',sortable:false}
];
const money = (value:string) => formatPlanningMoney(value,props.currency);
const dateLabel = (value:string) => value.split('-').reverse().join('.');
function open(selectedQueryId = '', selectedBudgetId = ''):void {
    queryId.value = queryOptions.value.some(q => q.value === selectedQueryId) ? selectedQueryId : queryOptions.value[0]?.value || '';
    budgetId.value = budgetOptions.value.some(b => b.value === selectedBudgetId) ? selectedBudgetId : '';
    search.value = ''; page.value = 1; shown.value = !!queryId.value;
}
function openTransaction(id:string):void { shown.value = false; emit('click:transaction',id); }
function download():void {
    const url = URL.createObjectURL(new Blob([contributionCSV(filtered.value,props.currency)],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');link.href = url;link.download = 'ezbook-calculation-transactions.csv';link.click();URL.revokeObjectURL(url);
}
watch([queryId,budgetId,search],() => { page.value = 1; });
watch(budgetOptions,options => { if (!options.some(b => b.value === budgetId.value)) budgetId.value = ''; });
watch(() => props.comparison,() => { shown.value = false; });
watch(() => props.currency,() => { shown.value = false; });
defineExpose({open});
</script>

<style scoped>
.evidence-controls,.evidence-actions{display:flex;flex-wrap:wrap;gap:20px;align-items:center}.evidence-controls>*{min-width:220px;flex:1}.evidence-actions .v-input{min-width:230px;flex:1}
.evidence-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.evidence-totals>div{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid rgba(var(--v-border-color),.2);border-radius:10px}.evidence-totals strong{font-size:1.4rem}.evidence-totals span,.evidence-totals small{opacity:.8}
.evidence-amount{white-space:nowrap;font-variant-numeric:tabular-nums}.evidence-transactions :deep(td){min-width:110px}.evidence-transactions :deep(td:nth-child(5)){min-width:180px;overflow-wrap:anywhere}
</style>
