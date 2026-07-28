package save

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

var (
	ErrNotFound       = errors.New("save not found")
	ErrConflict       = errors.New("save revision conflict")
	ErrIdempotencyKey = errors.New("idempotency key reused for a different request")
	ErrQuotaExceeded  = errors.New("cloud save quota exceeded")
)

type Key struct {
	ROMID string `json:"romId"`
	Kind  string `json:"kind"`
	Slot  string `json:"slot"`
}

type Version struct {
	Key
	Revision    int64     `json:"revision"`
	Checksum    string    `json:"checksum"`
	SizeBytes   int64     `json:"sizeBytes"`
	CoreBuildID string    `json:"coreBuildId"`
	DeviceID    string    `json:"deviceId,omitempty"`
	DeviceName  string    `json:"deviceName,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	Deleted     bool      `json:"deleted,omitempty"`
}

type Head struct {
	Key
	CurrentRevision int64     `json:"currentRevision"`
	Checksum        string    `json:"checksum"`
	SizeBytes       int64     `json:"sizeBytes"`
	CoreBuildID     string    `json:"coreBuildId"`
	DeviceName      string    `json:"deviceName,omitempty"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type CommitInput struct {
	UserID string
	Key
	BaseRevision   int64
	Checksum       string
	BlobDigest     string
	SizeBytes      int64
	CoreBuildID    string
	DeviceID       string
	IdempotencyKey string
	RequestHash    string
}

type CommitResult struct {
	Version Version `json:"save"`
	Replay  bool    `json:"idempotentReplay"`
}

type RestoreInput struct {
	UserID string
	Key
	SourceRevision int64
	BaseRevision   int64
	DeviceID       string
	IdempotencyKey string
	RequestHash    string
}

type Content struct {
	Version
	BlobDigest string
}

type ConflictError struct{ Current Head }

func (e *ConflictError) Error() string {
	return fmt.Sprintf("%s: current revision is %d", ErrConflict, e.Current.CurrentRevision)
}
func (e *ConflictError) Unwrap() error { return ErrConflict }

type Repository interface {
	Commit(ctx context.Context, input CommitInput) (CommitResult, error)
	Restore(ctx context.Context, input RestoreInput) (CommitResult, error)
	List(ctx context.Context, userID, romID string) ([]Head, error)
	ListVersions(ctx context.Context, userID string, key Key) ([]Version, error)
	GetContent(ctx context.Context, userID string, key Key, revision int64) (Content, error)
	DeleteHead(ctx context.Context, userID string, key Key) error
	DeleteROM(ctx context.Context, userID, romID string) error
}

type Upload struct {
	Key
	BaseRevision   int64
	ExpectedSHA256 string
	CoreBuildID    string
	DeviceID       string
	IdempotencyKey string
	Body           io.Reader
}
