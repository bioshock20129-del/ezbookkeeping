package services

import (
	"encoding/json/v2"
	"errors"
	"strconv"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/datastore"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/planning"
	"github.com/mayswind/ezbookkeeping/pkg/utils"
	"xorm.io/xorm"
)

type FinancialPlanningService struct{ ServiceUsingDB }

var FinancialPlans = &FinancialPlanningService{ServiceUsingDB: ServiceUsingDB{container: datastore.Container}}

func (s *FinancialPlanningService) Get(c core.Context, uid int64) (planning.Plan, error) {
	p := planning.Plan{Budgets: []planning.Budget{}, Items: []planning.Item{}}
	if uid <= 0 {
		return p, errors.New("invalid user")
	}
	record := models.FinancialPlanning{}
	has, err := s.UserDataDB(uid).NewSession(c).Where("uid=?", uid).Get(&record)
	if err != nil || !has {
		return p, err
	}
	err = json.Unmarshal([]byte(record.Data), &p)
	p.Revision = record.Revision
	return p, err
}

func (s *FinancialPlanningService) ValidateReferences(c core.Context, uid int64, p planning.Plan) (planning.Plan, error) {
	if uid <= 0 {
		return p, errors.New("invalid user")
	}
	if err := planning.Validate(p); err != nil {
		return p, err
	}
	accounts, err := Accounts.GetAllAccountsByUid(c, uid)
	if err != nil {
		return p, err
	}
	amap := map[string]*models.Account{}
	for _, a := range accounts {
		if a.Type == models.ACCOUNT_TYPE_SINGLE_ACCOUNT {
			amap[strconv.FormatInt(a.AccountId, 10)] = a
		}
	}
	categories, err := TransactionCategories.GetAllCategoriesByUid(c, uid, 0, -1)
	if err != nil {
		return p, err
	}
	cats := map[string]*models.TransactionCategory{}
	for _, v := range categories {
		cats[strconv.FormatInt(v.CategoryId, 10)] = v
	}
	expanded := p
	expanded.Budgets = append([]planning.Budget{}, p.Budgets...)
	seen := map[string]bool{}
	for idx, b := range p.Budgets {
		if _, ok := amap[b.AccountID]; !ok {
			return p, errors.New("budget account not found")
		}
		ids := map[string]bool{}
		for _, id := range b.CategoryIDs {
			category, ok := cats[id]
			if !ok || category.Type != models.CATEGORY_TYPE_EXPENSE {
				return p, errors.New("expense category not found")
			}
			ids[id] = true
			for cid, child := range cats {
				if child.ParentCategoryId == category.CategoryId {
					ids[cid] = true
				}
			}
		}
		expanded.Budgets[idx].CategoryIDs = []string{}
		for id := range ids {
			key := b.AccountID + "/" + id
			if seen[key] {
				return p, errors.New("budgets overlap on the same account and category")
			}
			seen[key] = true
			expanded.Budgets[idx].CategoryIDs = append(expanded.Budgets[idx].CategoryIDs, id)
		}
	}
	for _, i := range p.Items {
		a, ok := amap[i.AccountID]
		if !ok {
			return p, errors.New("planned account not found")
		}
		if i.Kind == "transfer" {
			b, ok := amap[i.DestinationID]
			if !ok || a.Currency != b.Currency {
				return p, errors.New("transfer accounts must have the same currency")
			}
		}
	}
	return expanded, nil
}
func (s *FinancialPlanningService) Save(c core.Context, uid int64, p planning.Plan) (planning.Plan, error) {
	if _, err := s.ValidateReferences(c, uid, p); err != nil {
		return p, err
	}
	if p.Budgets == nil {
		p.Budgets = []planning.Budget{}
	}
	if p.Items == nil {
		p.Items = []planning.Item{}
	}
	if p.Revision < 0 {
		return p, errors.New("invalid revision")
	}
	encoded, err := json.Marshal(p)
	if err != nil {
		return p, err
	}
	record := models.FinancialPlanning{Uid: uid, Revision: p.Revision + 1, Data: string(encoded)}
	err = s.UserDataDB(uid).DoTransaction(c, func(sess *xorm.Session) error {
		if p.Revision == 0 {
			_, err := sess.Insert(&record)
			return err
		}
		count, err := sess.Where("uid=? AND revision=?", uid, p.Revision).Cols("data", "revision").Update(&record)
		if err == nil && count != 1 {
			return errors.New("planning changed in another session; reload before saving")
		}
		return err
	})
	if err != nil {
		return p, err
	}
	p.Revision++
	return p, nil
}
func (s *FinancialPlanningService) Clear(c core.Context, uid int64) error {
	if uid <= 0 {
		return errors.New("invalid user")
	}
	_, err := s.UserDataDB(uid).NewSession(c).Where("uid=?", uid).Delete(&models.FinancialPlanning{})
	return err
}
func (s *FinancialPlanningService) Preview(c core.Context, uid int64, through string, loc *time.Location, optional bool) (planning.Result, error) {
	empty := planning.Result{}
	p, err := s.Get(c, uid)
	if err != nil {
		return empty, err
	}
	p, err = s.ValidateReferences(c, uid, p)
	if err != nil {
		return empty, err
	}
	now := time.Now().In(loc)
	end, err := time.ParseInLocation("2006-01-02", through, loc)
	if err != nil || end.Before(time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)) || end.After(now.AddDate(0, 0, 365)) {
		return empty, errors.New("invalid forecast horizon")
	}
	accounts, err := Accounts.GetAllAccountsByUid(c, uid)
	if err != nil {
		return empty, err
	}
	aa := []planning.Account{}
	for _, a := range accounts {
		if a.Type == models.ACCOUNT_TYPE_SINGLE_ACCOUNT {
			aa = append(aa, planning.Account{ID: strconv.FormatInt(a.AccountId, 10), Name: a.Name, Currency: a.Currency, Balance: a.Balance, Liability: a.Category.IsLiability()})
		}
	}
	// Account.Balance includes recorded future transactions. Load ALL future rows,
	// including beyond the horizon, to reverse them from the opening balance.
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	rows := []*models.Transaction{}
	err = s.UserDataDB(uid).NewSession(c).Where("uid=? AND deleted=? AND transaction_time>=?", uid, false, utils.GetMinTransactionTimeFromUnixTime(start.Unix())).Asc("transaction_time").Limit(100001).Find(&rows)
	if err != nil {
		return empty, err
	}
	if len(rows) > 100000 {
		return empty, errors.New("too many transactions for forecast; no partial report returned")
	}
	tt := []planning.Transaction{}
	for _, t := range rows {
		tt = append(tt, planning.Transaction{ID: strconv.FormatInt(t.TransactionId, 10), AccountID: strconv.FormatInt(t.AccountId, 10), CategoryID: strconv.FormatInt(t.CategoryId, 10), Kind: int(t.Type), Amount: t.Amount, Time: time.Unix(utils.GetUnixTimeFromTransactionTime(t.TransactionTime), 0).In(loc)})
	}
	return planning.Preview(p, aa, tt, now, end, optional)
}
