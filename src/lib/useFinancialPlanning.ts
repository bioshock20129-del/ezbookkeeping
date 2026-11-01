
import { onMounted, ref } from 'vue';
import '@/lib/services.ts';
import { generateRandomUUID } from '@/lib/misc.ts';
import { displayMoney, flatAccounts, planningRequest, toMinor, parseFinancialPlan, type FinancialPlan, type PlanningAccount, type PlanningCategory, type PlanningBudget, type PlanningItem, type ForecastResult } from '@/lib/planning.ts';

export function useFinancialPlanning() {
const plan = ref<FinancialPlan>({revision: 0, budgets: [], items: []});
const accounts = ref<PlanningAccount[]>([]), expenseCategories = ref<PlanningCategory[]>([]);
const result = ref<ForecastResult>();
const busy = ref(false), dirty = ref(false), loaded = ref(false), error = ref(''), notice = ref('');
const future = new Date(); future.setDate(future.getDate() + 89);
const through = ref(localDate(future)), includeOptional = ref(false);
function localDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function changed() { dirty.value = true; result.value = undefined; notice.value = ''; }
function fail(e: unknown) { error.value = e instanceof Error ? e.message : 'Ошибка запроса'; }
async function load() { busy.value = true; error.value = ''; try {
    const [p, a, c] = await Promise.all([planningRequest<FinancialPlan>('planning/get.json'), planningRequest<PlanningAccount[]>('accounts/list.json'), planningRequest<Record<string,PlanningCategory[]>>('transaction/categories/list.json')]);
    plan.value = p; accounts.value = flatAccounts(a); expenseCategories.value = (c['2'] || []).flatMap(p => [p, ...(p.subCategories || []).map(s => ({...s, name: `${p.name} / ${s.name}`}))]); dirty.value = false; result.value = undefined; loaded.value = true;
} catch(e) { loaded.value = false; fail(e); } finally { busy.value = false; } }
async function save() { if(!loaded.value)return; busy.value = true; error.value = ''; try { plan.value = await planningRequest<FinancialPlan>('planning/save.json', plan.value); dirty.value = false; notice.value = 'План сохранён'; await preview(); } catch(e) { fail(e); } finally { busy.value = false; } }
async function preview() { if(!loaded.value || dirty.value)return; busy.value = true; error.value = ''; result.value = undefined; try { result.value = await planningRequest<ForecastResult>('planning/preview.json', {through: through.value, includeOptional: includeOptional.value}); } catch(e) { fail(e); } finally { busy.value = false; } }
function addBudget() { if(!loaded.value)return; plan.value.budgets.push({id: generateRandomUUID(), name: '', accountId: '', categoryIds: [], limit: '0', estimate: false}); changed(); }
function removeBudget(id: string) { plan.value.budgets = plan.value.budgets.filter(b => b.id !== id); for(const i of plan.value.items) if(i.budgetId === id) i.budgetId = ''; changed(); }
function addItem() { if(!loaded.value)return; plan.value.items.push({id: generateRandomUUID(), name: '', kind: 'expense', accountId: '', destinationId: '', budgetId: '', amount: '0', date: localDate(new Date()), frequency: 'once', endDate: '', optional: false, skipDates: []}); changed(); }
function resetItem(i: PlanningItem) { i.budgetId = ''; i.destinationId = ''; changed(); }
function setAmount(target: PlanningBudget | PlanningItem, field: 'limit' | 'amount', event: Event) { try {const value = toMinor((event.target as HTMLInputElement).value); if(field === 'limit' && 'limit' in target) target.limit = value; if(field === 'amount' && 'amount' in target) target.amount = value; error.value = ''; changed();} catch(e) {fail(e); (event.target as HTMLInputElement).value = displayMoney(field === 'limit' && 'limit' in target ? target.limit : 'amount' in target ? target.amount : '0');} }
function setSkips(i: PlanningItem, e: Event) { i.skipDates = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean); changed(); }
function accountName(id: string) {return accounts.value.find(a => a.id === id)?.name || id;}
function chart(id: string) { const values = result.value?.points.filter(p => p.accountId === id).map(p => Number(p.balance)) || []; const min = Math.min(0,...values), max = Math.max(0,...values), range = max-min || 1; return values.map((v,i) => `${5+i*590/Math.max(1,values.length-1)},${115-(v-min)*110/range}`).join(' '); }
function download() { const url = URL.createObjectURL(new Blob([JSON.stringify(plan.value,null,2)],{type:'application/json'})); const a = document.createElement('a'); a.href=url; a.download='ezbook-financial-plan.json'; a.click(); URL.revokeObjectURL(url); }
async function restore(e: Event) { const file=(e.target as HTMLInputElement).files?.[0]; if(!file)return; try {if(file.size>1_000_000)throw new Error('Файл слишком большой'); plan.value=parseFinancialPlan(await file.text(),plan.value.revision); changed(); notice.value='Проверьте восстановленный план и сохраните его. Сервер проверит счета и категории.';} catch(err){fail(err);} }
onMounted(load);
return {plan,accounts,expenseCategories,result,busy,dirty,loaded,error,notice,through,includeOptional,localDate,changed,fail,load,save,preview,addBudget,removeBudget,addItem,resetItem,setAmount,setSkips,accountName,chart,download,restore};

}
