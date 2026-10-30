package planning

import (
	"testing"
	"time"
)

func tm(s string) time.Time {
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return v
}
func account(balance int64) []Account {
	return []Account{{ID: "a", Name: "Bank", Currency: "RUB", Balance: balance}}
}
func final(r Result, id string) int64 {
	for n := len(r.Points) - 1; n >= 0; n-- {
		if r.Points[n].AccountID == id {
			return r.Points[n].Balance
		}
	}
	return 0
}
func item(id, kind, date string, amount int64) Item {
	return Item{ID: id, Name: id, Kind: kind, AccountID: "a", Amount: amount, Date: date, Frequency: "once"}
}
func budget(limit int64, estimate bool) Budget {
	return Budget{ID: "food", Name: "Food", AccountID: "a", CategoryIDs: []string{"cat"}, Limit: limit, Estimate: estimate}
}

func TestSalaryRentAndBudget(t *testing.T) {
	p := Plan{Budgets: []Budget{budget(1000000, true)}, Items: []Item{item("salary", "income", "2026-11-05", 5000000), item("rent", "expense", "2026-11-10", 3000000)}}
	r, err := Preview(p, account(2000000), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if final(r, "a") != 3000000 {
		t.Fatalf("balance %d", final(r, "a"))
	}
	var estimates int64
	for _, e := range r.Events {
		if e.Source == "estimate" {
			estimates -= e.Amount
		}
	}
	if estimates != 1000000 {
		t.Fatal(estimates)
	}
}
func TestBudgetDoesNotDoubleCountPlannedExpense(t *testing.T) {
	expense := item("lunch", "expense", "2026-11-20", 200000)
	expense.BudgetID = "food"
	p := Plan{Budgets: []Budget{budget(2500000, true)}, Items: []Item{expense}}
	tx := []Transaction{{ID: "paid", AccountID: "a", CategoryID: "cat", Kind: 3, Amount: 800000, Time: tm("2026-11-02T10:00:00Z")}}
	r, err := Preview(p, account(2000000), tx, tm("2026-11-03T10:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	b := r.Budgets[0]
	if b.Spent != 800000 || b.Committed != 200000 || b.Estimated != 1500000 {
		t.Fatalf("report %+v", b)
	}
	if final(r, "a") != 300000 {
		t.Fatal(final(r, "a"))
	}
}
func TestFutureRecordedBalanceReversedAndIncludedOnce(t *testing.T) {
	tx := []Transaction{{ID: "future", AccountID: "a", Kind: 2, Amount: 500000, Time: tm("2026-11-20T10:00:00Z")}}
	for _, sample := range []struct {
		end  string
		want int64
	}{{"2026-11-10T00:00:00Z", 1000000}, {"2026-11-30T00:00:00Z", 1500000}} {
		r, err := Preview(Plan{}, account(1500000), tx, tm("2026-11-01T00:00:00Z"), tm(sample.end), false)
		if err != nil {
			t.Fatal(err)
		}
		if r.Accounts[0].Balance != 1000000 || final(r, "a") != sample.want {
			t.Fatalf("%+v %d", r.Accounts, final(r, "a"))
		}
	}
}
func TestFutureExpenseIsCommittedNotSpent(t *testing.T) {
	tx := []Transaction{{ID: "future", AccountID: "a", CategoryID: "cat", Kind: 3, Amount: 5000, Time: tm("2026-11-20T10:00:00Z")}}
	r, err := Preview(Plan{Budgets: []Budget{budget(10000, true)}}, account(10000), tx, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Budgets[0].Spent != 0 || r.Budgets[0].Committed != 5000 || r.Budgets[0].Estimated != 5000 {
		t.Fatalf("%+v", r.Budgets)
	}
}
func TestPartialHorizonReservesPlansBeyondHorizon(t *testing.T) {
	expense := item("later", "expense", "2026-11-25", 5000)
	expense.BudgetID = "food"
	r, err := Preview(Plan{Budgets: []Budget{budget(11000, true)}, Items: []Item{expense}}, account(20000), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-10T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Budgets[0].Committed != 5000 || r.Budgets[0].Estimated != 2000 {
		t.Fatalf("%+v", r.Budgets)
	}
	if final(r, "a") != 18000 {
		t.Fatal(final(r, "a"))
	}
}
func TestMinBalanceDetectsDeficitBeforeIncome(t *testing.T) {
	r, err := Preview(Plan{Items: []Item{item("spend", "expense", "2026-11-05", 15000), item("salary", "income", "2026-11-20", 10000)}}, account(10000), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if r.Minimum["a"] != "-5000" || final(r, "a") != 5000 {
		t.Fatalf("minimum %v final %d", r.Minimum, final(r, "a"))
	}
}
func TestTransferDoesNotSpendBudgetOrChangeTotal(t *testing.T) {
	transfer := item("transfer", "transfer", "2026-11-05", 5000)
	transfer.DestinationID = "b"
	aa := append(account(10000), Account{ID: "b", Currency: "RUB", Balance: 0})
	r, err := Preview(Plan{Items: []Item{transfer}}, aa, nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if final(r, "a") != 5000 || final(r, "b") != 5000 {
		t.Fatal(r.Points)
	}
	aa[1].Currency = "USD"
	if _, err := Preview(Plan{Items: []Item{transfer}}, aa, nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false); err == nil {
		t.Fatal("accepted FX without rate")
	}
}
func TestMonthlyClampsDayAndSkipsPaidOccurrences(t *testing.T) {
	i := item("monthly", "expense", "2024-01-31", 100)
	i.Frequency = "monthly"
	i.SkipDates = []string{"2024-03-31"}
	i.EndDate = "2024-03-31"
	r, err := Preview(Plan{Items: []Item{i}}, account(1000), nil, tm("2024-02-01T00:00:00Z"), tm("2024-04-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Events) != 1 || r.Events[0].Date != "2024-02-29" {
		t.Fatal(r.Events)
	}
}
func TestCalendarDSTAndExactCentDistribution(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Date(2026, 3, 29, 0, 0, 0, 0, loc)
	end := time.Date(2026, 3, 31, 0, 0, 0, 0, loc)
	r, err := Preview(Plan{Budgets: []Budget{budget(5, true)}}, account(100), nil, now, end, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Points) != 3 || final(r, "a") != 95 {
		t.Fatal(r.Points)
	}
	for n, want := range []int64{-2, -2, -1} {
		if r.Events[n].Amount != want {
			t.Fatal(r.Events)
		}
	}
}
func TestLimitWithoutEstimateDoesNotInventSpending(t *testing.T) {
	r, err := Preview(Plan{Budgets: []Budget{budget(25000, false)}}, account(100), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Events) != 0 || final(r, "a") != 100 {
		t.Fatal(r)
	}
}
func TestInvalidPlansAndOverlapsRejected(t *testing.T) {
	p := Plan{Budgets: []Budget{budget(1, false), {ID: "other", Name: "Other", AccountID: "a", CategoryIDs: []string{"cat"}, Limit: 1}}}
	if _, err := Preview(p, account(100), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false); err == nil {
		t.Fatal("overlap accepted")
	}
	for _, i := range []Item{item("x", "bad", "2026-11-01", 1), item("x", "expense", "2026-02-30", 1), item("x", "income", "2026-11-01", 0)} {
		if Validate(Plan{Items: []Item{i}}) == nil {
			t.Fatal(i)
		}
	}
}
func TestOptionalScenario(t *testing.T) {
	i := item("optional", "expense", "2026-11-10", 10)
	i.Optional = true
	for _, include := range []bool{false, true} {
		r, err := Preview(Plan{Items: []Item{i}}, account(100), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), include)
		if err != nil {
			t.Fatal(err)
		}
		want := int64(100)
		if include {
			want = 90
		}
		if final(r, "a") != want {
			t.Fatal(r)
		}
	}
}

func TestUnknownAccountAndAggregateOverflowRejected(t *testing.T) {
	p := Plan{Items: []Item{item("x", "income", "2026-11-05", 100)}}
	p.Items[0].AccountID = "foreign"
	if _, err := Preview(p, account(100), nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false); err == nil {
		t.Fatal("unknown account accepted")
	}
	aa := []Account{{ID: "a", Currency: "RUB", Balance: 9223372036854775807}, {ID: "b", Currency: "RUB", Balance: 1}}
	if _, err := Preview(Plan{}, aa, nil, tm("2026-11-01T00:00:00Z"), tm("2026-11-30T00:00:00Z"), false); err == nil {
		t.Fatal("overflow accepted")
	}
}
