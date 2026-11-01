<template>
    <div class="source-settings">
        <v-select label="Источник данных" :items="sources" item-title="name" item-value="id" v-model="query.source" :disabled="disabled" hide-details />
        <template v-if="query.source !== 'difference' && (query.source !== 'actual' || hasComparison)">
            <v-select v-if="query.source !== 'budget'" label="Показатель" :items="flows" item-title="name" item-value="id" v-model="query.flow" :disabled="disabled" hide-details />
            <v-select label="Счета" :items="accounts" item-title="name" item-value="id" multiple chips clearable v-model="query.accountIds" :disabled="disabled" hide-details placeholder="Все счета" />
            <v-select label="Бюджеты" :items="budgets" item-title="name" item-value="id" multiple chips clearable v-model="query.budgetIds" :disabled="disabled || !!planError" hide-details placeholder="Все бюджеты" />
            <template v-if="query.source === 'forecast'">
                <v-select label="Метод прогноза" :items="methods" item-title="name" item-value="id" v-model="query.forecastMethod" :disabled="disabled" hide-details />
                <v-checkbox v-if="query.forecastMethod === 'plans'" label="Учитывать необязательные планы" v-model="query.includeOptional" :disabled="disabled" hide-details />
            </template>
        </template>
        <template v-else-if="query.source === 'difference'">
            <v-select label="Из запроса" :items="baseQueries" item-title="name" item-value="id" v-model="query.leftQueryId" :disabled="disabled" hide-details />
            <v-select label="Вычесть запрос" :items="baseQueries" item-title="name" item-value="id" v-model="query.rightQueryId" :disabled="disabled" hide-details />
        </template>
    </div>
    <p class="text-body-small text-medium-emphasis mt-4 mb-0" v-if="query.source === 'actual'">Для операций применяются условия ниже. При сравнении с бюджетом или прогнозом также используются показатель, счета и бюджеты. Без выбора бюджета — все подходящие операции.</p>
    <p class="text-body-small text-medium-emphasis mt-4 mb-0" v-if="query.source === 'budget'">Месячный лимит выбранных бюджетов распределяется по календарным дням. Без выбора — все бюджеты. Частичный период содержит только свою долю лимита.</p>
    <p class="text-body-small text-medium-emphasis mt-4 mb-0" v-if="query.source === 'forecast'">Факт до текущего момента + будущие суммы. По планам: сохранённые платежи, будущие записанные операции и оценка остатка бюджета. По темпу: средний расход за прошедшие дни выбранного периода, без добавления плановых событий. Для прогноза доходов выберите метод «По планам».</p>
    <p class="text-body-small text-medium-emphasis mt-4 mb-0" v-if="query.source === 'difference'">Первый запрос минус второй, в одной валюте. Положительная разница «Факт − Бюджет» означает превышение плана на эту дату.</p>
    <v-alert v-if="query.source !== 'actual' && query.conditions.length" type="info" variant="tonal" class="mt-4">Условия операций сохранены и применятся при возврате к источнику «Операции». Для этого источника используйте параметры выше.</v-alert>
    <v-alert v-if="planError" type="warning" variant="tonal" class="mt-4">{{ planError }} <v-btn variant="text" size="small" @click="$emit('retry')">Повторить</v-btn></v-alert>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { TransactionExplorerQuery } from '@/models/explorer.ts';
import type { PlanningBudget } from '@/lib/planning.ts';
const props=defineProps<{query:TransactionExplorerQuery;queries:TransactionExplorerQuery[];budgets:PlanningBudget[];accounts:{id:string;name:string}[];disabled?:boolean;planError:string}>();
defineEmits<{retry:[]}>();
const query=computed(()=>props.query);
const hasComparison=computed(()=>props.queries.some(q=>q.source!=='actual'||q.accountIds.length||q.budgetIds.length||q.flow!=='expense'));
const baseQueries=computed(()=>props.queries.filter(q=>q.id!==query.value.id&&q.source!=='difference').map(q=>({id:q.id,name:q.name||'Без названия'})));
const sources=[{id:'actual',name:'Операции (факт)'},{id:'budget',name:'Бюджет'},{id:'forecast',name:'Прогноз'},{id:'difference',name:'Разница запросов'}];
const flows=[{id:'expense',name:'Расходы'},{id:'income',name:'Доходы'},{id:'net',name:'Денежный поток (доходы − расходы)'}];
const methods=[{id:'plans',name:'По сохранённым планам'},{id:'pace',name:'По темпу фактических расходов'}];
</script>
<style scoped>
.source-settings {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding-top:8px;}
@media(max-width:700px){.source-settings{grid-template-columns:minmax(0,1fr);}}
</style>
