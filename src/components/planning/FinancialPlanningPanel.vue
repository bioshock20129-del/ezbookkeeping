<template>
<section class="financial-planning">
    <h1>Бюджеты и прогноз</h1>
    <p>Месячные лимиты, будущие поступления и платежи. Прогноз не создаёт операций и не меняет баланс.</p>
    <p class="error" role="alert" v-if="error">{{ error }}</p>
    <p role="status" v-if="notice">{{ notice }}</p>
    <div class="toolbar">
        <button type="button" @click="save" :disabled="busy">Сохранить план</button>
        <button type="button" @click="load" :disabled="busy || dirty">Обновить</button>
        <button type="button" @click="download" :disabled="busy">Скачать план JSON</button>
        <label>Восстановить план <input type="file" accept=".json,application/json" @change="restore" :disabled="busy" /></label>
        <span v-if="dirty">Есть несохранённые изменения</span>
    </div>
    <fieldset :disabled="busy">
    <legend>Месячные бюджеты</legend>
    <p>Лимит действует каждый месяц. «Распределять остаток» означает сценарий расходования всего оставшегося лимита, а не обязательство.</p>
    <article v-for="b in plan.budgets" :key="b.id" class="editor-row">
        <label>Название <input v-model="b.name" maxlength="64" @input="changed" /></label>
        <label>Счёт <select v-model="b.accountId" @change="changed"><option value="">Выберите счёт</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.currency }}</option></select></label>
        <label>Категории <select v-model="b.categoryIds" multiple @change="changed"><option v-for="c in expenseCategories" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>Лимит <input :value="displayMoney(b.limit)" inputmode="decimal" @change="setAmount(b, 'limit', $event)" /></label>
        <label><input type="checkbox" v-model="b.estimate" @change="changed" />Распределять остаток по дням</label>
        <button type="button" @click="removeBudget(b.id)">Удалить бюджет</button>
    </article>
    <button type="button" @click="addBudget">Добавить бюджет</button>
    </fieldset>
    <fieldset :disabled="busy">
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
        <button type="button" @click="preview" :disabled="busy || dirty">Рассчитать прогноз</button>
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
import { onMounted, ref } from 'vue';
import '@/lib/services.ts';
import { generateRandomUUID } from '@/lib/misc.ts';
import { displayMoney, flatAccounts, planningRequest, toMinor, parseFinancialPlan, type FinancialPlan, type PlanningAccount, type PlanningCategory, type PlanningBudget, type PlanningItem, type ForecastResult } from '@/lib/planning.ts';
const plan = ref<FinancialPlan>({revision: 0, budgets: [], items: []});
const accounts = ref<PlanningAccount[]>([]), expenseCategories = ref<PlanningCategory[]>([]);
const result = ref<ForecastResult>();
const busy = ref(false), dirty = ref(false), error = ref(''), notice = ref('');
const future = new Date(); future.setDate(future.getDate() + 90);
const through = ref(localDate(future)), includeOptional = ref(false);
function localDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function changed() { dirty.value = true; result.value = undefined; notice.value = ''; }
function fail(e: unknown) { error.value = e instanceof Error ? e.message : 'Ошибка запроса'; }
async function load() { busy.value = true; error.value = ''; try {
    const [p, a, c] = await Promise.all([planningRequest<FinancialPlan>('planning/get.json'), planningRequest<PlanningAccount[]>('accounts/list.json'), planningRequest<Record<string,PlanningCategory[]>>('transaction/categories/list.json')]);
    plan.value = p; accounts.value = flatAccounts(a); expenseCategories.value = (c['2'] || []).flatMap(p => [p, ...(p.subCategories || []).map(s => ({...s, name: `${p.name} / ${s.name}`}))]); dirty.value = false; result.value = undefined;
} catch(e) { fail(e); } finally { busy.value = false; } }
async function save() { busy.value = true; error.value = ''; try { plan.value = await planningRequest<FinancialPlan>('planning/save.json', plan.value); dirty.value = false; notice.value = 'План сохранён'; } catch(e) { fail(e); } finally { busy.value = false; } }
async function preview() { busy.value = true; error.value = ''; result.value = undefined; try { result.value = await planningRequest<ForecastResult>('planning/preview.json', {through: through.value, includeOptional: includeOptional.value}); } catch(e) { fail(e); } finally { busy.value = false; } }
function addBudget() { plan.value.budgets.push({id: generateRandomUUID(), name: '', accountId: '', categoryIds: [], limit: '0', estimate: false}); changed(); }
function removeBudget(id: string) { plan.value.budgets = plan.value.budgets.filter(b => b.id !== id); for(const i of plan.value.items) if(i.budgetId === id) i.budgetId = ''; changed(); }
function addItem() { plan.value.items.push({id: generateRandomUUID(), name: '', kind: 'expense', accountId: '', destinationId: '', budgetId: '', amount: '0', date: localDate(new Date()), frequency: 'once', endDate: '', optional: false, skipDates: []}); changed(); }
function resetItem(i: PlanningItem) { i.budgetId = ''; i.destinationId = ''; changed(); }
function setAmount(target: PlanningBudget | PlanningItem, field: 'limit' | 'amount', event: Event) { try {const value = toMinor((event.target as HTMLInputElement).value); if(field === 'limit' && 'limit' in target) target.limit = value; if(field === 'amount' && 'amount' in target) target.amount = value; error.value = ''; changed();} catch(e) {fail(e); (event.target as HTMLInputElement).value = displayMoney(field === 'limit' && 'limit' in target ? target.limit : 'amount' in target ? target.amount : '0');} }
function setSkips(i: PlanningItem, e: Event) { i.skipDates = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); changed(); }
function accountName(id: string) {return accounts.value.find(a => a.id === id)?.name || id;}
function chart(id: string) { const values = result.value?.points.filter(p => p.accountId === id).map(p => Number(p.balance)) || []; const min = Math.min(0,...values), max = Math.max(0,...values), range = max-min || 1; return values.map((v,i) => `${5+i*590/Math.max(1,values.length-1)},${115-(v-min)*110/range}`).join(' '); }
function download() { const url = URL.createObjectURL(new Blob([JSON.stringify(plan.value,null,2)],{type:'application/json'})); const a = document.createElement('a'); a.href=url; a.download='ezbook-financial-plan.json'; a.click(); URL.revokeObjectURL(url); }
async function restore(e: Event) { const file=(e.target as HTMLInputElement).files?.[0]; if(!file)return; try {if(file.size>1_000_000)throw new Error('Файл слишком большой'); plan.value=parseFinancialPlan(await file.text(),plan.value.revision); changed(); notice.value='Проверьте восстановленный план и сохраните его. Сервер проверит счета и категории.';} catch(err){fail(err);} }
onMounted(load);
</script>

<style scoped>
.financial-planning{padding:1rem;max-width:1200px;margin:auto}.toolbar,.editor-row{display:flex;gap:.8rem;flex-wrap:wrap;align-items:center;margin:1rem 0}.editor-row{padding:1rem;border:1px solid #8886;border-radius:8px}fieldset{margin:1rem 0;padding:1rem;border:1px solid #8886}label{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}input:not([type=checkbox]),select,button{border:1px solid #8888;border-radius:4px;padding:.4rem;background:transparent;color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}select[multiple]{min-height:5rem}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #8885;white-space:nowrap}.error{color:#c62828}svg{width:100%;height:120px;color:#1976d2}.account-forecast{margin:1rem 0}details{margin:1rem 0}
</style>
