package account

import (
	"context"
	"errors"
	"time"
)

var ErrUnavailable = errors.New("account is not active")

type LoginResult struct {
	UserID    string
	DeviceID  string
	SessionID string
}

type DeletionStatus struct {
	JobID     string    `json:"jobId"`
	Status    string    `json:"status"`
	Attempts  int       `json:"attempts"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Repository interface {
	Login(context.Context, string, string, string, time.Time) (LoginResult, error)
	SessionActive(context.Context, string, string) (bool, error)
	RefreshSession(context.Context, string, string, time.Time) error
	RevokeSession(context.Context, string, string) error
	RequestDeletion(context.Context, string) (DeletionStatus, error)
	DeletionStatus(context.Context, string) (DeletionStatus, error)
}
