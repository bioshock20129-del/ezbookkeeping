<template>
<section class="financial-planning">
    <h1>Бюджеты и прогноз</h1>
    <p>Месячные лимиты, будущие поступления и платежи. Прогноз не создаёт операций и не меняет баланс.</p>
    <p class="error" role="alert" v-if="error">{{ error }}</p>
    <p role="status" v-if="notice">{{ notice }}</p>
    <div class="toolbar">
        <button type="button" @click="save" :disabled="busy || !loaded">Сохранить план</button>
        <button type="button" @click="load" :disabled="busy || dirty">Обновить</button>
        <button type="button" @click="download" :disabled="busy || !loaded">Скачать план JSON</button>
        <label>Восстановить план <input type="file" accept=".json,application/json" @change="restore" :disabled="busy || !loaded" /></label>
        <span v-if="dirty">Есть несохранённые изменения</span>
    </div>
    <fieldset :disabled="busy || !loaded">
    <legend>Месячные бюджеты</legend>
    <p v-for="total in monthlyTotals" :key="total.currency"><strong>План на месяц: {{ formatPlanningMoney(total.limit, total.currency || '(валюта не выбрана)') }}</strong></p>
    <p>Лимит действует каждый месяц. По умолчанию прогноз учитывает датированные доходы и платежи. Остаток бюджета можно отдельно учесть одним расходом в последний день месяца.</p>
    <article v-for="b in plan.budgets" :key="b.id" class="editor-row">
        <label>Название <input v-model="b.name" maxlength="64" @input="changed" /></label>
        <label>Счёт <select v-model="b.accountId" @change="changed"><option value="">Выберите счёт</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.currency }}</option></select></label>
        <label>Категории <select v-model="b.categoryIds" multiple @change="changed"><option v-for="c in expenseCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>Лимит <input :value="displayMoney(b.limit)" inputmode="decimal" @change="setAmount(b, 'limit', $event)" /></label>
        <label><input type="checkbox" v-model="b.estimate" @change="changed" />Учесть остаток бюджета в конце месяца</label>
        <button type="button" @click="removeBudget(b.id)">Удалить бюджет</button>
    </article>
    <button type="button" @click="addBudget">Добавить бюджет</button>
    </fieldset>
    <fieldset :disabled="busy || !loaded">
    <legend>Будущие доходы и платежи</legend>
    <p>Разовые события или ежемесячно в день указанной даты, в 12:00 по вашему часовому поясу. Прошедшие даты в прогноз не включаются. 29–31-е число в коротком месяце переносится на его последний день.</p>
    <p>Если операция уже записана в ezBookKeeping, укажите её дату в пропусках плана, чтобы не учитывать её дважды. Штатные расписания автоматически не добавляются.</p>
    <article v-for="item in plan.items" :key="item.id" class="editor-row">
        <label>Название <input v-model="item.name" maxlength="64" @input="changed" /></label>
        <label>Тип <select v-model="item.kind" @change="resetItem(item)"><option value="expense">Расход</option><option value="income">Доход</option><option value="transfer">Перевод</option></select></label>
        <label>Счёт <select v-model="item.accountId" @change="item.budgetId = ''; changed()"><option value="">Выберите счёт</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.currency }}</option></select></label>
        <label v-if="item.kind === 'transfer'">Куда <select v-model="item.destinationId" @change="changed"><option value="">Выберите счёт</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.currency }}</option></select></label>
        <label>Сумма <input :value="displayMoney(item.amount)" inputmode="decimal" @change="setAmount(item, 'amount', $event)" /></label>
        <label>Дата начала <input type="date" v-model="item.date" @change="changed" /></label>
        <label>Повтор <select v-model="item.frequency" @change="changed"><option value="once">Один раз</option><option value="monthly">Ежемесячно</option></select></label>
        <label>Дата окончания <input type="date" v-model="item.endDate" @change="changed" /></label>
        <label v-if="item.kind === 'expense'">Входит в бюджет <select v-model="item.budgetId" @change="changed"><option value="">Без бюджета</option><option v-for="b in plan.budgets.filter(b => b.accountId === item.accountId)" :key="b.id" :value="b.id">{{ b.name }}</option></select></label>
        <label><input type="checkbox" v-model="item.optional" @change="changed" />Необязательный</label>
        <label>Пропуски / уже оплаченные даты (ГГГГ-ММ-ДД, через запятую)<input :value="item.skipDates.join(', ')" @change="setSkips(item, $event)" /></label>
        <button type="button" @click="plan.items = plan.items.filter(i => i.id !== item.id); changed()">Удалить план</button>
    </article>
    <button type="button" @click="addItem">Добавить доход / платёж</button>
    </fieldset>
    <div class="toolbar">
        <label>Прогноз до <input type="date" v-model="through" @change="result = undefined" /></label>
        <label><input type="checkbox" v-model="includeOptional" @change="result = undefined" />Учитывать необязательные планы</label>
        <button type="button" @click="preview" :disabled="busy || dirty || !loaded">Рассчитать прогноз</button>
    </div>
    <template v-if="result">
        <h2>Бюджеты текущего месяца</h2>
        <div class="table-scroll"><table><thead><tr><th>Бюджет</th><th>Валюта</th><th>Лимит</th><th>Факт</th><th>Предстоит явно</th><th>Оценка до горизонта</th><th>Свободно до оценки</th></tr></thead><tbody>
            <tr v-for="b in result.budgets" :key="b.id"><td>{{ b.name }}</td><td>{{ b.currency }}</td><td>{{ displayMoney(b.limit) }}</td><td>{{ displayMoney(b.spent) }}</td><td>{{ displayMoney(b.committed) }}</td><td>{{ displayMoney(b.estimated) }}</td><td :class="{ error: Number(b.remaining) < 0 }">{{ displayMoney(b.remaining) }}</td></tr>
        </tbody></table></div>
        <h2>Прогноз остатков</h2>
        <p>По состоянию на {{ result.asOf }}. Валюты не суммируются. Минимум учитывает порядок событий внутри дня.</p>
        <div v-for="a in result.accounts" :key="a.id" class="account-forecast">
            <h3>{{ a.name }} · {{ a.currency }}: сейчас {{ displayMoney(a.balance) }}, минимум {{ displayMoney(result.minimum[a.id] || '0') }}</h3>
            <p class="error" v-if="Number(result.minimum[a.id]) < 0">{{ a.isLiability ? 'Прогнозируется долг по счёту. Кредитный лимит не учитывается.' : 'В сценарии возможен недостаток средств на счёте.' }}</p>
            <svg viewBox="0 0 600 120" role="img" :aria-label="`Остаток по счёту ${a.name}`"><polyline :points="chart(a.id)" fill="none" stroke="currentColor" stroke-width="2" /></svg>
        </div>
        <details><summary>Остатки на конец дня</summary><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Счёт</th><th>Остаток</th></tr></thead><tbody><tr v-for="p in result.points" :key="p.date + p.accountId"><td>{{ p.date }}</td><td>{{ accountName(p.accountId) }}</td><td>{{ displayMoney(p.balance) }}</td></tr></tbody></table></div></details>
        <details><summary>События прогноза: {{ result.events.length }}</summary><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Счёт</th><th>Событие</th><th>Источник</th><th>Сумма</th></tr></thead><tbody><tr v-for="e in result.events" :key="e.source + e.id"><td>{{ e.date }}</td><td>{{ accountName(e.accountId) }}</td><td>{{ e.name }}</td><td>{{ ({actual: 'Записанная операция', planned: 'План', estimate: 'Оценка бюджета'} as Record<string,string>)[e.source] }}</td><td>{{ displayMoney(e.amount) }}</td></tr></tbody></table></div></details>
    </template>
</section>
</template>

<script setup lang="ts">
import { monthlyBudgetTotals, formatPlanningMoney, displayMoney } from '@/lib/planning.ts';
import { computed } from 'vue';
import { useFinancialPlanning } from '@/lib/useFinancialPlanning.ts';
const {plan,accounts,expenseCategories,result,busy,dirty,loaded,error,notice,through,includeOptional,changed,load,save,preview,addBudget,removeBudget,addItem,resetItem,setAmount,setSkips,accountName,chart,download,restore} = useFinancialPlanning();
const monthlyTotals=computed(()=>monthlyBudgetTotals(plan.value.budgets,accounts.value,result.value?.budgets));
</script>


<style scoped>
.financial-planning{padding:1rem;max-width:1200px;margin:auto}.toolbar,.editor-row{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center;margin:1rem 0}.editor-row{padding:1rem;border:1px solid #8886;border-radius:8px}fieldset{margin:1rem 0;padding:1rem;border:1px solid #8886}label{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}input:not([type=checkbox]),select,button{border:1px solid #8888;border-radius:4px;padding:.4rem;background:transparent;color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}select[multiple]{min-height:5rem}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #8885;white-space:nowrap}.error{color:#c62828}svg{width:100%;height:120px;color:#1976d2}.account-forecast{margin:1rem 0}details{margin:1rem 0}
</style>
