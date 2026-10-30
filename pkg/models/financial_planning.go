package models

// FinancialPlanning stores the user's versioned, explicit budgets and future plans.
// It is separate from Transaction: forecasts never affect the actual ledger.
type FinancialPlanning struct {
	Uid      int64  `xorm:"PK"`
	Revision int64  `xorm:"NOT NULL"`
	Data     string `xorm:"MEDIUMBLOB"`
}
