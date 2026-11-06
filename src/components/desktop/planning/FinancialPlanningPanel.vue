<template>
    <section class="planning-workspace">
        <header class="planning-heading">
            <div><div class="text-label-medium text-medium-emphasis">Финансовое планирование</div><h1 class="text-headline-large font-weight-bold">Бюджеты и прогноз</h1><p class="text-body-large text-medium-emphasis mt-2">Планируйте расходы и смотрите, сколько останется на счетах.</p></div>
            <div class="d-flex align-center ga-3">
                <v-chip v-if="dirty" color="warning" variant="tonal" size="small">Есть изменения</v-chip>
                <v-btn color="primary" :disabled="!loaded || !dirty || busy" :loading="busy && loaded" @click="save">Сохранить изменения</v-btn>
                <v-menu><template #activator="{ props }"><v-btn v-bind="props" icon :disabled="!loaded || busy" variant="text" aria-label="Действия с планом"><v-icon :icon="mdiDotsVertical" /></v-btn></template><v-list>
                    <v-list-item title="Обновить данные" :disabled="dirty" @click="load" />
                    <v-list-item title="Экспортировать план" @click="download" />
                    <v-list-item title="Восстановить из файла" @click="fileInput?.click()" />
                </v-list></v-menu>
                <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="restore" />
            </div>
        </header>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-5" role="alert"><div>{{ errorText }}</div><v-btn v-if="!loaded" class="mt-2" variant="text" @click="load" :loading="busy">Повторить загрузку</v-btn></v-alert>
        <v-alert v-if="notice" type="success" variant="tonal" density="compact" class="mb-4" closable @click:close="notice = ''">{{ notice }}</v-alert>
        <v-skeleton-loader v-if="busy && !loaded" type="heading, table" />
        <template v-if="loaded">
            <div class="planning-overview mb-6">
                <v-card class="planning-card" variant="flat" rounded="lg"><v-card-text><span class="text-body-medium text-medium-emphasis">План на месяц</span><div v-for="total in monthlyTotals" :key="total.currency" class="text-headline-large mt-2 amount">{{ totalMoney(total.limit, total.currency) }}</div><div v-if="!monthlyTotals.length" class="text-headline-large mt-2">—</div><div class="text-body-medium text-medium-emphasis mt-1">Бюджетов: {{ plan.budgets.length }} · сумма месячных лимитов</div></v-card-text></v-card>
                <v-card class="planning-card" variant="flat" rounded="lg"><v-card-text><span class="text-body-medium text-medium-emphasis">Доходы и платежи</span><div class="text-headline-large mt-2">{{ plan.items.length }}</div><div class="text-body-medium text-medium-emphasis mt-1">Разовые и ежемесячные планы</div></v-card-text></v-card>
                <v-card class="planning-card" variant="flat" rounded="lg"><v-card-text><span class="text-body-medium text-medium-emphasis">Горизонт прогноза</span><div class="text-headline-large mt-2">{{ horizonDays }} <span class="text-body-large">дней</span></div><div class="text-body-medium text-medium-emphasis mt-1">До {{ dateLabel(through) }}</div></v-card-text></v-card>
            </div>
            <v-card class="planning-card" variant="flat" rounded="lg">
                <v-tabs v-model="tab" color="primary"><v-tab value="budgets">Бюджеты</v-tab><v-tab value="items">Доходы и платежи</v-tab><v-tab value="forecast">Прогноз</v-tab></v-tabs><v-divider />
                <v-card-text class="pa-5 pa-md-6">
                    <template v-if="tab === 'budgets'">
                        <div class="section-heading"><div><h2 class="text-title-large">Бюджеты текущего месяца</h2><p class="text-body-medium text-medium-emphasis mt-1">Факт, предстоящие платежи и доступный остаток.</p></div><v-btn color="primary" variant="tonal" :disabled="busy || accounts.length === 0 || expenseCategories.length === 0" @click="editBudget()">Добавить бюджет</v-btn></div>
                        <v-alert v-if="!accounts.length || !expenseCategories.length" type="info" variant="tonal" class="mb-4">Сначала добавьте счёт и категории расходов в ezBookKeeping.</v-alert>
                        <div v-if="!plan.budgets.length" class="planning-empty"><v-icon :icon="mdiWalletOutline" size="42" color="primary" /><h3 class="text-title-large mt-4">Бюджетов пока нет</h3><p class="text-body-medium text-medium-emphasis mt-2">Создайте первый бюджет — например, на продукты или транспорт.</p></div>
                        <v-table v-else><thead><tr><th>Бюджет</th><th>Счёт</th><th class="text-end">Лимит</th><th class="text-end">Потрачено</th><th class="text-end">Предстоит</th><th class="text-end">Остаток*</th><th aria-label="Действия" /></tr></thead><tbody><tr v-for="b in plan.budgets" :key="b.id">
                            <td class="py-4"><div class="font-weight-medium">{{ b.name }}</div><div class="text-body-small text-medium-emphasis mt-1">{{ categoryLabel(b) }}</div><v-progress-linear v-if="report(b.id)" :model-value="progress(b)" :color="Number(report(b.id)?.remaining) < 0 ? 'error' : 'primary'" rounded class="mt-2" /></td>
                            <td>{{ accountName(b.accountId) }}</td><td class="text-end amount">{{ money(b.limit, b.accountId) }}</td><td class="text-end amount">{{ report(b.id) ? money(report(b.id)!.spent, b.accountId) : '—' }}</td><td class="text-end amount">{{ report(b.id) ? money(report(b.id)!.committed, b.accountId) : '—' }}</td><td class="text-end amount" :class="{ 'text-error': Number(report(b.id)?.remaining) < 0 }">{{ report(b.id) ? money(report(b.id)!.remaining, b.accountId) : '—' }}</td><td><v-btn variant="text" size="small" @click="editBudget(b)" :disabled="busy">Изменить</v-btn><v-btn icon variant="text" size="small" :disabled="busy" @click="removeBudget(b.id)" aria-label="Удалить бюджет"><v-icon :icon="mdiDeleteOutline" /></v-btn></td>
                        </tr></tbody><tfoot><tr v-for="total in monthlyTotals" :key="total.currency" class="font-weight-bold"><td colspan="2">Итого за месяц · {{ total.currency || 'валюта не выбрана' }}</td><td class="text-end amount">{{ totalMoney(total.limit, total.currency) }}</td><td class="text-end amount">{{ totalMoney(total.spent, total.currency) }}</td><td class="text-end amount">{{ totalMoney(total.committed, total.currency) }}</td><td class="text-end amount">{{ totalMoney(total.remaining, total.currency) }}</td><td /></tr></tfoot></v-table>
                        <p v-if="plan.budgets.length" class="text-body-small text-medium-emphasis mt-4">* Лимит за вычетом факта и явных будущих платежей. При изменении плана сохраните его для обновления расчётов.</p>
                    </template>
                    <template v-else-if="tab === 'items'">
                        <div class="section-heading"><div><h2 class="text-title-large">Будущие доходы и платежи</h2><p class="text-body-medium text-medium-emphasis mt-1">Зарплата, аренда, подписки и крупные покупки.</p></div><v-btn color="primary" variant="tonal" :disabled="busy || !accounts.length" @click="editItem()">Добавить план</v-btn></div>
                        <div v-if="!plan.items.length" class="planning-empty"><v-icon :icon="mdiCalendarClockOutline" size="42" color="primary" /><h3 class="text-title-large mt-4">Планов пока нет</h3><p class="text-body-medium text-medium-emphasis mt-2">Добавьте ближайший доход или обязательный платёж — они появятся в прогнозе.</p></div>
                        <v-table v-else><thead><tr><th>План</th><th>Дата и повтор</th><th>Счёт</th><th class="text-end">Сумма</th><th aria-label="Действия" /></tr></thead><tbody><tr v-for="i in plan.items" :key="i.id"><td class="py-4"><div class="font-weight-medium">{{ i.name }}</div><v-chip size="x-small" variant="tonal" :color="i.kind === 'income' ? 'success' : 'default'" class="mt-1">{{ kindLabel(i.kind) }}</v-chip><v-chip v-if="i.optional" size="x-small" variant="outlined" class="ms-1">Необязательный</v-chip></td><td>{{ dateLabel(i.date) }}<div class="text-body-small text-medium-emphasis">{{ i.frequency === 'monthly' ? 'Ежемесячно' : 'Один раз' }}</div></td><td>{{ accountName(i.accountId) }}<div v-if="i.budgetId" class="text-body-small text-medium-emphasis">{{ plan.budgets.find(b => b.id === i.budgetId)?.name }}</div></td><td class="text-end amount" :class="{ 'text-success': i.kind === 'income' }">{{ i.kind === 'income' ? '+' : i.kind === 'expense' ? '−' : '' }}{{ money(i.amount, i.accountId) }}</td><td><v-btn variant="text" size="small" :disabled="busy" @click="editItem(i)">Изменить</v-btn><v-btn icon variant="text" size="small" :disabled="busy" @click="removeItem(i.id)" aria-label="Удалить план"><v-icon :icon="mdiDeleteOutline" /></v-btn></td></tr></tbody></v-table>
                    </template>
                    <template v-else>
                        <div class="section-heading"><div><h2 class="text-title-large">Сколько останется на счетах</h2><p class="text-body-medium text-medium-emphasis mt-1">Сценарий на основе операций, явных планов и выбранных бюджетов.</p></div><v-btn color="primary" :disabled="busy || dirty" :loading="busy" @click="preview">Рассчитать</v-btn></div>
                        <div class="forecast-controls"><v-select label="Горизонт" :items="horizons" item-title="title" item-value="value" :model-value="horizonPreset" @update:model-value="chooseHorizon" density="comfortable" hide-details /><v-text-field label="Прогноз до" type="date" v-model="through" @update:model-value="result = undefined" density="comfortable" hide-details /><v-switch v-model="includeOptional" label="Необязательные планы" color="primary" hide-details @update:model-value="result = undefined" /></div>
                        <v-alert v-if="dirty" type="info" variant="tonal" class="mt-4">Сохраните изменения плана, чтобы рассчитать прогноз.</v-alert>
                        <div v-if="!result && !busy" class="planning-empty"><v-icon :icon="mdiChartTimelineVariant" size="42" color="primary" /><h3 class="text-title-large mt-4">Прогноз ещё не рассчитан</h3><p class="text-body-medium text-medium-emphasis mt-2">Выберите горизонт и рассчитайте ожидаемые остатки.</p></div>
                        <template v-if="result">
                            <div class="mt-6"><v-select v-model="selectedAccount" :items="result.accounts" item-title="name" item-value="id" label="Счёт для прогноза" hide-details density="comfortable" /></div>
                            <template v-if="activeAccount">
                                <div class="planning-overview mt-5"><div><span class="text-body-medium text-medium-emphasis">Сейчас</span><div class="text-headline-small mt-1">{{ money(activeAccount.balance, activeAccount.id) }}</div></div><div><span class="text-body-medium text-medium-emphasis">На конец периода</span><div class="text-headline-small mt-1">{{ money(endingBalance, activeAccount.id) }}</div></div><div><span class="text-body-medium text-medium-emphasis">Минимум за период</span><div class="text-headline-small mt-1" :class="{ 'text-error': Number(result.minimum[activeAccount.id]) < 0 }">{{ money(result.minimum[activeAccount.id] || '0', activeAccount.id) }}</div></div></div>
                                <v-alert v-if="Number(result.minimum[activeAccount.id]) < 0" type="warning" variant="tonal" class="mt-4">{{ activeAccount.isLiability ? 'Прогнозируется долг. Кредитный лимит не включён в расчёт.' : 'В этом сценарии остаток может стать отрицательным.' }}</v-alert>
                                <div class="forecast-chart mt-6"><div class="text-body-small text-medium-emphasis mb-2">Остаток на конец дня · {{ activeAccount.currency }}</div><svg viewBox="0 0 600 160" role="img" :aria-label="`Прогноз по счёту ${activeAccount.name}`"><line x1="0" y1="155" x2="600" y2="155" stroke="currentColor" opacity="0.1" /><polyline :points="graphPoints" fill="none" stroke="rgb(var(--v-theme-primary))" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg><div class="d-flex justify-space-between text-body-small text-medium-emphasis"><span>{{ dateLabel(result.points[0]?.date || '') }}</span><span>{{ dateLabel(result.through) }}</span></div></div>
                            </template>
                            <div class="d-flex align-center justify-space-between mt-8 mb-3"><h3 class="text-title-medium font-weight-bold">Из чего складывается прогноз</h3><span class="text-body-small text-medium-emphasis">{{ filteredEvents.length }} событий</span></div>
                            <v-table><thead><tr><th>Дата</th><th>Событие</th><th>Источник</th><th class="text-end">Сумма</th></tr></thead><tbody><tr v-for="e in eventPage" :key="e.source + e.id"><td>{{ dateLabel(e.date) }}</td><td>{{ e.name }}</td><td><v-chip size="small" variant="tonal" :color="e.source === 'estimate' ? 'secondary' : 'default'">{{ sourceLabel(e.source) }}</v-chip></td><td class="text-end amount">{{ money(e.amount, e.accountId) }}</td></tr></tbody></v-table><v-pagination v-if="filteredEvents.length > 12" v-model="page" :length="Math.ceil(filteredEvents.length / 12)" :total-visible="5" class="mt-3" />
                            <p class="text-body-small text-medium-emphasis mt-4">Прогноз — сценарий, а не новые операции. Валюты считаются отдельно; фактические даты и суммы могут отличаться.</p>
                        </template>
                    </template>
                </v-card-text>
            </v-card>
        </template>
        <v-dialog v-model="budgetDialog" max-width="640" persistent scrollable><v-card rounded="lg"><v-card-title class="pa-6">{{ budgetDraft.id ? 'Изменить бюджет' : 'Новый бюджет' }}</v-card-title><v-card-text class="planning-dialog-form">
            <v-alert v-if="dialogError" type="error" variant="tonal" class="mb-4">{{ dialogError }}</v-alert><v-text-field v-model="budgetDraft.name" label="Название" placeholder="Например, продукты" maxlength="64" autofocus />
            <v-select v-model="budgetDraft.accountId" :items="accountOptions" item-title="title" item-value="value" label="Счёт" />
            <v-autocomplete v-model="budgetDraft.categoryIds" :items="expenseCategories" item-title="name" item-value="id" multiple chips closable-chips label="Категории расходов" />
            <v-text-field v-model="budgetDraft.amount" label="Месячный лимит" inputmode="decimal" :suffix="currency(budgetDraft.accountId)" />
            <v-switch v-model="budgetDraft.estimate" label="Учесть остаток бюджета в конце месяца" color="primary" hide-details /><p class="text-body-medium text-medium-emphasis mt-2">Остаток после факта и датированных платежей учитывается одним расходом в последний день месяца. По умолчанию прогноз использует только операции и планы с датами.</p>
        </v-card-text><v-card-actions class="pa-5"><v-spacer /><v-btn variant="text" @click="budgetDialog = false">Отмена</v-btn><v-btn color="primary" variant="flat" @click="applyBudget">{{ budgetDraft.id ? 'Применить' : 'Добавить' }}</v-btn></v-card-actions></v-card></v-dialog>
        <v-dialog v-model="itemDialog" max-width="720" persistent scrollable><v-card rounded="lg"><v-card-title class="pa-6">{{ itemDraft.id ? 'Изменить план' : 'Новый доход или платёж' }}</v-card-title><v-card-text class="planning-dialog-form">
            <v-alert v-if="dialogError" type="error" variant="tonal" class="mb-4">{{ dialogError }}</v-alert><v-text-field v-model="itemDraft.name" label="Название" placeholder="Например, зарплата или аренда" maxlength="64" autofocus /><v-select v-model="itemDraft.kind" :items="kinds" item-title="title" item-value="value" label="Тип" @update:model-value="itemDraft.budgetId = ''; itemDraft.destinationId = ''" />
            <div class="planning-form-row"><div class="planning-form-cell"><v-select v-model="itemDraft.accountId" :items="accountOptions" item-title="title" item-value="value" label="Счёт" @update:model-value="itemDraft.budgetId = ''" /></div><div class="planning-form-cell"><v-text-field v-model="itemDraft.amount" label="Сумма" inputmode="decimal" :suffix="currency(itemDraft.accountId)" /></div></div>
            <v-select v-if="itemDraft.kind === 'transfer'" v-model="itemDraft.destinationId" :items="accountOptions.filter(a => a.value !== itemDraft.accountId)" item-title="title" item-value="value" label="Счёт зачисления" />
            <div class="planning-form-row"><div class="planning-form-cell"><v-text-field v-model="itemDraft.date" label="Дата" type="date" /></div><div class="planning-form-cell"><v-select v-model="itemDraft.frequency" :items="[{title:'Один раз',value:'once'},{title:'Ежемесячно',value:'monthly'}]" item-title="title" item-value="value" label="Повтор" /></div></div>
            <v-select v-if="itemDraft.kind === 'expense'" v-model="itemDraft.budgetId" :items="[{title:'Без бюджета',value:''}, ...plan.budgets.filter(b => b.accountId === itemDraft.accountId).map(b => ({title:b.name,value:b.id}))]" item-title="title" item-value="value" label="Входит в бюджет" />
            <v-checkbox v-model="itemDraft.optional" label="Необязательный план" color="primary" hide-details />
            <v-expansion-panels variant="accordion" class="mt-3"><v-expansion-panel title="Повторы и уже оплаченные даты"><v-expansion-panel-text><div class="planning-dialog-extra"><v-text-field v-model="itemDraft.endDate" type="date" label="Последняя дата (необязательно)" /><v-textarea v-model="itemDraft.skips" label="Пропустить даты" placeholder="2026-11-05, 2026-12-05" rows="2" /><p class="text-body-medium text-medium-emphasis">Если операция уже записана, укажите её дату здесь. События плана учитываются в 12:00; прошедшие даты не переносятся на сегодня.</p></div></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
        </v-card-text><v-card-actions class="pa-5"><v-spacer /><v-btn variant="text" @click="itemDialog = false">Отмена</v-btn><v-btn color="primary" variant="flat" @click="applyItem">{{ itemDraft.id ? 'Применить' : 'Добавить' }}</v-btn></v-card-actions></v-card></v-dialog>
    </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiDotsVertical, mdiDeleteOutline, mdiWalletOutline, mdiCalendarClockOutline, mdiChartTimelineVariant } from '@mdi/js';
import { useFinancialPlanning } from '@/lib/useFinancialPlanning.ts';
import { displayMoney, formatPlanningMoney, monthlyBudgetTotals, toMinor, type PlanningBudget, type PlanningItem } from '@/lib/planning.ts';
import { generateRandomUUID } from '@/lib/misc.ts';
const {plan,accounts,expenseCategories,result,busy,dirty,loaded,error,notice,through,includeOptional,localDate,changed,load,save,preview,removeBudget,accountName,download,restore} = useFinancialPlanning();
const monthlyTotals=computed(()=>monthlyBudgetTotals(plan.value.budgets,accounts.value,result.value?.budgets));
const totalMoney=(value:string|null,currency:string)=>value===null?'—':formatPlanningMoney(value,currency||'(валюта не выбрана)');
const tab=ref('budgets'), fileInput=ref<HTMLInputElement>(), budgetDialog=ref(false), itemDialog=ref(false), dialogError=ref(''), selectedAccount=ref(''), page=ref(1);
const horizons=[{title:'30 дней',value:30},{title:'90 дней',value:90},{title:'180 дней',value:180}];
const kinds=[{title:'Расход',value:'expense'},{title:'Доход',value:'income'},{title:'Перевод',value:'transfer'}];
const horizonDays=computed(()=>Math.max(1,Math.round((new Date(through.value+'T12:00:00').getTime()-new Date(localDate(new Date())+'T12:00:00').getTime())/86400000)+1));
const horizonPreset=computed(()=>horizons.some(h=>h.value===horizonDays.value)?horizonDays.value:undefined);
const accountOptions=computed(()=>accounts.value.map(a=>({title:`${a.name} · ${a.currency}`,value:a.id})));
const errorText=computed(()=>error.value==='api not found'?'Не удалось загрузить данные планирования. Обновите образ форка и повторите загрузку.':error.value);
const activeAccount=computed(()=>result.value?.accounts.find(a=>a.id===selectedAccount.value));
const points=computed(()=>result.value?.points.filter(p=>p.accountId===selectedAccount.value)||[]);
const endingBalance=computed(()=>points.value.at(-1)?.balance||activeAccount.value?.balance||'0');
const filteredEvents=computed(()=>result.value?.events.filter(e=>e.accountId===selectedAccount.value)||[]);
const eventPage=computed(()=>filteredEvents.value.slice((page.value-1)*12,page.value*12));
const graphPoints=computed(()=>{const values=points.value.map(p=>Number(p.balance)),min=Math.min(0,...values),max=Math.max(0,...values),range=max-min||1;return values.map((v,i)=>`${5+i*590/Math.max(1,values.length-1)},${150-(v-min)*140/range}`).join(' ');});
const budgetDraft=ref({id:'',name:'',accountId:'',categoryIds:[] as string[],amount:'',estimate:false});
const itemDraft=ref({id:'',name:'',kind:'expense',accountId:'',destinationId:'',budgetId:'',amount:'',date:'',frequency:'once',endDate:'',optional:false,skips:''});
function currency(id:string){return accounts.value.find(a=>a.id===id)?.currency||'';}
function money(value:string,id:string){return formatPlanningMoney(value,currency(id));}
function validDate(value:string){const d=new Date(value+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
function dateLabel(value:string){const parts=value.split('-');return parts.length===3?`${parts[2]}.${parts[1]}.${parts[0]}`:value;}
function kindLabel(value:string){return kinds.find(k=>k.value===value)?.title||value;}
function sourceLabel(value:string){return ({actual:'Операция',planned:'План',estimate:'Оценка бюджета'} as Record<string,string>)[value]||value;}
function categoryLabel(b:PlanningBudget){return b.categoryIds.map(id=>expenseCategories.value.find(c=>c.id===id)?.name||id).join(', ');}
function report(id:string){return result.value?.budgets.find(b=>b.id===id);}
function progress(b:PlanningBudget){return Number(b.limit)>0?Math.max(0,Math.min(100,Number(report(b.id)?.spent||0)/Number(b.limit)*100)):0;}
function chooseHorizon(days:number){const d=new Date();d.setDate(d.getDate()+days-1);through.value=localDate(d);result.value=undefined;}
function editBudget(b?:PlanningBudget){dialogError.value='';budgetDraft.value=b?{...b,categoryIds:[...b.categoryIds],amount:displayMoney(b.limit)}:{id:'',name:'',accountId:'',categoryIds:[],amount:'',estimate:false};budgetDialog.value=true;}
function applyBudget(){try{const b=budgetDraft.value;if(!b.name.trim()||!b.accountId||!b.categoryIds.length)throw new Error('Заполните название, счёт и категории.');if(b.id&&plan.value.items.some(i=>i.budgetId===b.id&&i.accountId!==b.accountId))throw new Error('Сначала измените счёт в планах, использующих этот бюджет.');const limit=toMinor(b.amount);if(limit==='0')throw new Error('Лимит должен быть больше нуля.');const value:PlanningBudget={id:b.id||generateRandomUUID(),name:b.name.trim(),accountId:b.accountId,categoryIds:[...b.categoryIds],limit,estimate:b.estimate};const index=plan.value.budgets.findIndex(v=>v.id===value.id);if(index<0)plan.value.budgets.push(value);else plan.value.budgets[index]=value;changed();budgetDialog.value=false;}catch(e){dialogError.value=e instanceof Error?e.message:'Проверьте поля бюджета';}}
function editItem(i?:PlanningItem){dialogError.value='';itemDraft.value=i?{...i,amount:displayMoney(i.amount),skips:i.skipDates.join(', ')}:{id:'',name:'',kind:'expense',accountId:'',destinationId:'',budgetId:'',amount:'',date:localDate(new Date()),frequency:'once',endDate:'',optional:false,skips:''};itemDialog.value=true;}
function applyItem(){try{const i=itemDraft.value;if(!i.name.trim()||!i.accountId||!i.date)throw new Error('Заполните название, счёт и дату.');if(!validDate(i.date)||(i.endDate&&(!validDate(i.endDate)||i.endDate<i.date))||i.skips.split(',').map(s=>s.trim()).filter(Boolean).some(s=>!validDate(s)))throw new Error('Проверьте даты: используйте ГГГГ-ММ-ДД, окончание не раньше начала.');const amount=toMinor(i.amount);if(amount==='0')throw new Error('Сумма должна быть больше нуля.');if(i.kind==='transfer'&&(!i.destinationId||i.destinationId===i.accountId||currency(i.destinationId)!==currency(i.accountId)))throw new Error('Выберите два разных счёта одной валюты.');const value:PlanningItem={id:i.id||generateRandomUUID(),name:i.name.trim(),kind:i.kind,accountId:i.accountId,destinationId:i.kind==='transfer'?i.destinationId:'',budgetId:i.kind==='expense'?i.budgetId:'',amount,date:i.date,frequency:i.frequency,endDate:i.endDate,optional:i.optional,skipDates:i.skips.split(',').map(s=>s.trim()).filter(Boolean)};const index=plan.value.items.findIndex(v=>v.id===value.id);if(index<0)plan.value.items.push(value);else plan.value.items[index]=value;changed();itemDialog.value=false;}catch(e){dialogError.value=e instanceof Error?e.message:'Проверьте поля плана';}}
function removeItem(id:string){plan.value.items=plan.value.items.filter(i=>i.id!==id);changed();}
watch(loaded,ready=>{if(ready&&!dirty.value)void preview();});
watch(result,r=>{if(r&&!r.accounts.some(a=>a.id===selectedAccount.value))selectedAccount.value=r.accounts[0]?.id||'';page.value=1;});
watch(selectedAccount,()=>{page.value=1;});
</script>
<style scoped>
.planning-workspace{max-width:1280px;width:100%;padding:32px;margin:0 auto}.planning-heading,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.planning-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.planning-card{background:rgb(var(--ebk-surface));border:1px solid rgba(var(--ebk-border),.12)}.planning-empty{padding:60px 20px;text-align:center}.forecast-controls{display:grid;grid-template-columns:180px 200px minmax(200px,1fr);gap:20px;align-items:center}.amount{white-space:nowrap;font-variant-numeric:tabular-nums}.forecast-chart svg{width:100%;height:200px}.v-table td{border-bottom-color:rgba(var(--v-border-color),var(--v-border-opacity))} @media(max-width:900px){.planning-heading,.section-heading{align-items:flex-start;flex-direction:column}.planning-workspace{padding:20px}.planning-overview{grid-template-columns:1fr}.forecast-controls{grid-template-columns:1fr}.planning-heading h1{font-size:1.6rem!important}}

.planning-overview .amount{white-space:normal;overflow-wrap:anywhere;font-size:clamp(1.25rem,2.2vw,2rem)}
.planning-dialog-form.v-card-text{display:grid;align-content:start;gap:20px;padding:12px 24px 24px;min-height:0}
.planning-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.planning-form-cell{min-width:0}
.planning-dialog-extra{display:grid;align-content:start;gap:20px;padding-top:8px}
.planning-dialog-form :deep(.v-input){margin:0}
@media(max-width:600px){.planning-form-row{grid-template-columns:1fr}.planning-overview .amount{white-space:normal;overflow-wrap:anywhere;font-size:clamp(1.25rem,2.2vw,2rem)}
.planning-dialog-form.v-card-text{padding-inline:20px}}
</style>
