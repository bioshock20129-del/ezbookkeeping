package api

import (
	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/planning"
	"github.com/mayswind/ezbookkeeping/pkg/services"
)

type FinancialPlanningApi struct{}

var FinancialPlanning = &FinancialPlanningApi{}

func (a *FinancialPlanningApi) Get(c *core.WebContext) (any, *errs.Error) {
	p, err := services.FinancialPlans.Get(c, c.GetCurrentUid())
	if err != nil {
		log.Errorf(c, "[planning.get] uid=%d error=%s", c.GetCurrentUid(), err)
		return nil, errs.ErrOperationFailed
	}
	return p, nil
}
func (a *FinancialPlanningApi) Save(c *core.WebContext) (any, *errs.Error) {
	var p planning.Plan
	if err := c.ShouldBindJSON(&p); err != nil {
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}
	result, err := services.FinancialPlans.Save(c, c.GetCurrentUid(), p)
	if err != nil {
		log.Warnf(c, "[planning.save] uid=%d error=%s", c.GetCurrentUid(), err)
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}
	return result, nil
}
func (a *FinancialPlanningApi) Preview(c *core.WebContext) (any, *errs.Error) {
	var req struct {
		Through         string `json:"through" binding:"required"`
		IncludeOptional bool   `json:"includeOptional"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}
	loc, err := c.GetClientTimezone()
	if err != nil {
		return nil, errs.ErrClientTimezoneOffsetInvalid
	}
	result, err := services.FinancialPlans.Preview(c, c.GetCurrentUid(), req.Through, loc, req.IncludeOptional)
	if err != nil {
		log.Warnf(c, "[planning.preview] uid=%d error=%s", c.GetCurrentUid(), err)
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}
	log.Infof(c, "[planning.preview] uid=%d events=%d", c.GetCurrentUid(), len(result.Events))
	return result, nil
}
