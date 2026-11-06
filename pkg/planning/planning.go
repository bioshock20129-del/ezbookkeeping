// Package planning computes read-only budget reports and cashflow projections.
package planning

import (
	"errors"
	"math/big"
	"sort"
	"strconv"
	"time"
)

const MaxAmount int64 = 999999999999999

type Budget struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	AccountID   string   `json:"accountId"`
	CategoryIDs []string `json:"categoryIds"`
	Limit       int64    `json:"limit,string"`
	Estimate    bool     `json:"estimate"`
}
type Item struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`
	AccountID     string   `json:"accountId"`
	DestinationID string   `json:"destinationId"`
	BudgetID      string   `json:"budgetId"`
	Amount        int64    `json:"amount,string"`
	Date          string   `json:"date"`
	Frequency     string   `json:"frequency"`
	EndDate       string   `json:"endDate"`
	Optional      bool     `json:"optional"`
	SkipDates     []string `json:"skipDates"`
}
type Plan struct {
	Revision int64    `json:"revision"`
	Budgets  []Budget `json:"budgets"`
	Items    []Item   `json:"items"`
}
type Account struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	Balance   int64  `json:"balance,string"`
	Liability bool   `json:"isLiability"`
}
type Transaction struct {
	ID         string
	AccountID  string
	CategoryID string
	Kind       int
	Amount     int64
	Time       time.Time
}
type Event struct {
	Kind      string `json:"kind"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Date      string `json:"date"`
	AccountID string `json:"accountId"`
	BudgetID  string `json:"budgetId"`
	Amount    int64  `json:"amount,string"` // Signed cashflow.
	Source    string `json:"source"`        // actual, planned, estimate
	at        time.Time
}
type Point struct {
	Date      string `json:"date"`
	AccountID string `json:"accountId"`
	Balance   int64  `json:"balance,string"`
}
type BudgetReport struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	Limit     int64  `json:"limit,string"`
	Spent     int64  `json:"spent,string"`
	Committed int64  `json:"committed,string"`
	Estimated int64  `json:"estimated,string"`
	Remaining int64  `json:"remaining,string"`
}
type Result struct {
	AsOf     string            `json:"asOf"`
	Through  string            `json:"through"`
	Budgets  []BudgetReport    `json:"budgets"`
	Events   []Event           `json:"events"`
	Points   []Point           `json:"points"`
	Accounts []Account         `json:"accounts"` // Balances as of AsOf, not including future actual records.
	Minimum  map[string]string `json:"minimum"`
}

func Validate(p Plan) error {
	if len(p.Budgets) > 100 || len(p.Items) > 500 {
		return errors.New("too many budgets or planned items")
	}
	ids := map[string]bool{}
	validID := func(id string) bool {
		if id == "" || len(id) > 64 || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	budgets := map[string]Budget{}
	for _, b := range p.Budgets {
		if !validID(b.ID) || b.Name == "" || len([]rune(b.Name)) > 64 || b.AccountID == "" || len(b.CategoryIDs) == 0 || len(b.CategoryIDs) > 100 || b.Limit < 0 || b.Limit > MaxAmount {
			return errors.New("invalid budget")
		}
		budgets[b.ID] = b
	}
	for _, i := range p.Items {
		d, e := time.Parse("2006-01-02", i.Date)
		if !validID(i.ID) || i.Name == "" || len([]rune(i.Name)) > 64 || i.AccountID == "" || i.Amount <= 0 || i.Amount > MaxAmount || e != nil || d.Year() < 1970 || d.Year() > 9998 || (i.Frequency != "once" && i.Frequency != "monthly") || (i.Kind != "income" && i.Kind != "expense" && i.Kind != "transfer") {
			return errors.New("invalid planned item")
		}
		if i.Kind == "transfer" && (i.DestinationID == "" || i.AccountID == i.DestinationID) {
			return errors.New("transfer requires different accounts")
		}
		if i.Kind != "transfer" && i.DestinationID != "" {
			return errors.New("only transfers have a destination")
		}
		if i.BudgetID != "" {
			b, ok := budgets[i.BudgetID]
			if !ok || i.Kind != "expense" || b.AccountID != i.AccountID {
				return errors.New("planned expense must use its budget account")
			}
		}
		if i.EndDate != "" {
			end, err := time.Parse("2006-01-02", i.EndDate)
			if err != nil || end.Before(d) {
				return errors.New("invalid schedule end date")
			}
		}
		if len(i.SkipDates) > 366 {
			return errors.New("too many skipped dates")
		}
		for _, s := range i.SkipDates {
			if _, err := time.Parse("2006-01-02", s); err != nil {
				return errors.New("invalid skipped occurrence date")
			}
		}
	}
	return nil
}

func eventKind(kind int) string {
	switch kind {
	case 2:
		return "income"
	case 3:
		return "expense"
	case 4, 5:
		return "transfer"
	}
	return "adjustment"
}

func signed(t Transaction) int64 {
	if t.Kind == 3 || t.Kind == 4 {
		return -t.Amount
	}
	return t.Amount
}
func day(t time.Time) string   { return t.Format("2006-01-02") }
func month(t time.Time) string { return t.Format("2006-01") }
func date(s string, loc *time.Location) time.Time {
	v, _ := time.ParseInLocation("2006-01-02", s, loc)
	return v
}
func budgetFor(p Plan, t Transaction) string {
	if t.Kind != 3 {
		return ""
	}
	for _, b := range p.Budgets {
		if b.AccountID != t.AccountID {
			continue
		}
		for _, c := range b.CategoryIDs {
			if c == t.CategoryID {
				return b.ID
			}
		}
	}
	return ""
}

// Preview assumes account Balance includes all recorded operations, including future ones.
// Future actual transactions must therefore be supplied even beyond Through to undo them.
func Preview(p Plan, accounts []Account, transactions []Transaction, now, through time.Time, includeOptional bool) (Result, error) {
	r := Result{AsOf: now.Format(time.RFC3339), Through: day(through), Budgets: []BudgetReport{}, Events: []Event{}, Points: []Point{}, Accounts: append([]Account{}, accounts...), Minimum: map[string]string{}}
	if err := Validate(p); err != nil {
		return r, err
	}
	loc := now.Location()
	today := date(day(now), loc)
	if through.Before(today) || through.After(today.AddDate(0, 0, 365)) {
		return r, errors.New("forecast horizon must be between 1 and 366 calendar days")
	}
	end := date(day(through), loc).AddDate(0, 0, 1)
	amap := map[string]Account{}
	balances := map[string]int64{}
	for _, a := range accounts {
		if _, ok := amap[a.ID]; ok {
			return r, errors.New("duplicate account")
		}
		amap[a.ID] = a
		balances[a.ID] = a.Balance
	}
	coverage := map[string]bool{}
	for _, b := range p.Budgets {
		if _, ok := amap[b.AccountID]; !ok {
			return r, errors.New("budget account not found")
		}
		for _, c := range b.CategoryIDs {
			key := b.AccountID + "/" + c
			if coverage[key] {
				return r, errors.New("budget category rules overlap on the same account")
			}
			coverage[key] = true
		}
	}
	for _, i := range p.Items {
		a, ok := amap[i.AccountID]
		if !ok {
			return r, errors.New("planned account not found")
		}
		if i.Kind == "transfer" {
			b, ok := amap[i.DestinationID]
			if !ok || a.Currency != b.Currency {
				return r, errors.New("cross-currency transfers are not supported in planning")
			}
		}
	}
	// Bound the absolute total before int64 aggregation, rather than detecting wrapped values later.
	total := new(big.Int)
	addMagnitude := func(v int64) { n := big.NewInt(v); n.Abs(n); total.Add(total, n) }
	for _, a := range accounts {
		addMagnitude(a.Balance)
	}
	for _, t := range transactions {
		addMagnitude(t.Amount)
	}
	for _, b := range p.Budgets {
		for n := 0; n < 13; n++ {
			addMagnitude(b.Limit)
		}
	}
	for _, i := range p.Items {
		for n := 0; n < 26; n++ {
			addMagnitude(i.Amount)
		}
	}
	if !total.IsInt64() {
		return r, errors.New("forecast values exceed supported aggregate range")
	}
	minimum := map[string]int64{}
	spent := map[string]int64{}
	futureSpent := map[string]int64{}

	committed := map[string]int64{}
	estimated := map[string]int64{}
	for _, t := range transactions {
		if _, ok := amap[t.AccountID]; !ok {
			continue
		}
		if t.Amount > MaxAmount || t.Amount < -MaxAmount || t.Kind < 1 || t.Kind > 5 {
			return r, errors.New("invalid recorded transaction")
		}
		key := budgetFor(p, t) + "/" + month(t.Time.In(loc))
		if t.Kind == 3 {
			if t.Time.After(now) {
				futureSpent[key] += t.Amount
			} else {
				spent[key] += t.Amount
			}
		}
		if t.Time.After(now) {
			balances[t.AccountID] -= signed(t)
			if t.Time.Before(end) {
				r.Events = append(r.Events, Event{Kind: eventKind(t.Kind), ID: t.ID, Name: "Recorded transaction", Date: day(t.Time.In(loc)), AccountID: t.AccountID, BudgetID: budgetFor(p, t), Amount: signed(t), Source: "actual", at: t.Time})
			}
		}
	}
	scheduleEnd := time.Date(through.Year(), through.Month()+1, 1, 0, 0, 0, 0, loc)
	for _, i := range p.Items {
		if i.Optional && !includeOptional {
			continue
		}
		anchor := date(i.Date, loc)
		cursor := anchor
		if i.Frequency == "monthly" {
			cursor = time.Date(today.Year(), today.Month(), 1, 12, 0, 0, 0, loc)
		}
		for n := 0; n < 367; n++ {
			at := cursor
			if i.Frequency == "monthly" {
				last := time.Date(cursor.Year(), cursor.Month()+1, 0, 12, 0, 0, 0, loc).Day()
				d := anchor.Day()
				if d > last {
					d = last
				}
				at = time.Date(cursor.Year(), cursor.Month(), d, 12, 0, 0, 0, loc)
			} else {
				at = time.Date(cursor.Year(), cursor.Month(), cursor.Day(), 12, 0, 0, 0, loc)
			}
			if !at.Before(scheduleEnd) {
				break
			}
			skip := at.Before(anchor) || !at.After(now) || (i.EndDate != "" && day(at) > i.EndDate)
			for _, s := range i.SkipDates {
				if s == day(at) {
					skip = true
				}
			}
			if !skip {
				amount := i.Amount
				if i.Kind != "income" {
					amount = -amount
				}
				if at.Before(end) {
					r.Events = append(r.Events, Event{Kind: i.Kind, ID: i.ID + "/" + day(at), Name: i.Name, Date: day(at), AccountID: i.AccountID, BudgetID: i.BudgetID, Amount: amount, Source: "planned", at: at})
				}
				if i.BudgetID != "" {
					committed[i.BudgetID+"/"+month(at)] += i.Amount
				}
				if i.Kind == "transfer" && at.Before(end) {
					r.Events = append(r.Events, Event{Kind: i.Kind, ID: i.ID + "/" + day(at) + "/in", Name: i.Name, Date: day(at), AccountID: i.DestinationID, Amount: i.Amount, Source: "planned", at: at})
				}
			}
			if i.Frequency == "once" {
				break
			}
			cursor = cursor.AddDate(0, 1, 0)
		}
	}
	for _, b := range p.Budgets {
		for cursor := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, loc); cursor.Before(end); cursor = cursor.AddDate(0, 1, 0) {
			key := b.ID + "/" + month(cursor)
			remaining := b.Limit - spent[key] - futureSpent[key] - committed[key]
			if remaining < 0 {
				remaining = 0
			}
			if b.Estimate && remaining > 0 {
				// The optional residual is one month-end expense, after dated payments.
				// A horizon ending earlier must not pull this expense forward.
				at := cursor.AddDate(0, 1, 0).Add(-time.Nanosecond)
				if at.After(now) && at.Before(end) {
					r.Events = append(r.Events, Event{Kind: "expense", ID: b.ID + "/estimate/" + day(at), Name: b.Name, Date: day(at), AccountID: b.AccountID, BudgetID: b.ID, Amount: -remaining, Source: "estimate", at: at})
					estimated[key] += remaining
				}
			}
		}
		key := b.ID + "/" + month(now)
		r.Budgets = append(r.Budgets, BudgetReport{ID: b.ID, Name: b.Name, Currency: amap[b.AccountID].Currency, Limit: b.Limit, Spent: spent[key], Committed: committed[key] + futureSpent[key], Estimated: estimated[key], Remaining: b.Limit - spent[key] - futureSpent[key] - committed[key]})
	}
	if len(r.Events) > 20000 {
		return r, errors.New("too many forecast events")
	}
	sort.SliceStable(r.Events, func(i, j int) bool {
		if r.Events[i].at.Equal(r.Events[j].at) {
			if r.Events[i].Amount == r.Events[j].Amount {
				return r.Events[i].ID < r.Events[j].ID
			}
			return r.Events[i].Amount < r.Events[j].Amount
		}
		return r.Events[i].at.Before(r.Events[j].at)
	})
	for idx, a := range r.Accounts {
		r.Accounts[idx].Balance = balances[a.ID]
		minimum[a.ID] = balances[a.ID]
	}
	pos := 0
	for d := today; d.Before(end); d = d.AddDate(0, 0, 1) {
		next := d.AddDate(0, 0, 1)
		for pos < len(r.Events) && r.Events[pos].at.Before(next) {
			e := r.Events[pos]
			balances[e.AccountID] += e.Amount
			if balances[e.AccountID] < minimum[e.AccountID] {
				minimum[e.AccountID] = balances[e.AccountID]
			}
			pos++
		}
		for _, a := range accounts {
			r.Points = append(r.Points, Point{Date: day(d), AccountID: a.ID, Balance: balances[a.ID]})
		}
	}
	for id, value := range minimum {
		r.Minimum[id] = strconv.FormatInt(value, 10)
	}
	return r, nil
}
