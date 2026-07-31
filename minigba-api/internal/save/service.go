package save

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/minigba-cloud/minigba-api/internal/blob"
)

var (
	hex64Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	slotPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)
	uuidPattern  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
)

type Service struct {
	repository      Repository
	blobs           blob.Store
	maxBatteryBytes int64
	maxStateBytes   int64
}

func NewService(repository Repository, blobs blob.Store, maxBatteryBytes, maxStateBytes int64) (*Service, error) {
	if repository == nil || blobs == nil {
		return nil, errors.New("save repository and blob store are required")
	}
	if maxBatteryBytes <= 0 || maxStateBytes <= 0 {
		return nil, errors.New("save limits must be positive")
	}
	return &Service{repository: repository, blobs: blobs, maxBatteryBytes: maxBatteryBytes, maxStateBytes: maxStateBytes}, nil
}

func (s *Service) Upload(ctx context.Context, userID string, upload Upload) (CommitResult, error) {
	if err := validateKey(upload.Key); err != nil {
		return CommitResult{}, err
	}
	if userID == "" {
		return CommitResult{}, errors.New("user ID is required")
	}
	if upload.Body == nil {
		return CommitResult{}, errors.New("save body is required")
	}
	if upload.BaseRevision < 0 {
		return CommitResult{}, errors.New("base revision cannot be negative")
	}
	if !hex64Pattern.MatchString(upload.ExpectedSHA256) {
		return CommitResult{}, errors.New("X-Content-SHA256 must be a lowercase SHA-256 digest")
	}
	if !uuidPattern.MatchString(upload.IdempotencyKey) {
		return CommitResult{}, errors.New("Idempotency-Key must be a UUID")
	}
	upload.CoreBuildID = normalizeCoreBuildID(upload.CoreBuildID)
	if len(upload.CoreBuildID) == 0 || len(upload.CoreBuildID) > 128 {
		return CommitResult{}, errors.New("X-Core-Build-ID must contain 1 to 128 characters")
	}
	if upload.DeviceID != "" && !uuidPattern.MatchString(upload.DeviceID) {
		return CommitResult{}, errors.New("X-Device-ID must be a UUID")
	}
	unlock, err := s.blobs.LockDigest(upload.ExpectedSHA256)
	if err != nil {
		return CommitResult{}, err
	}
	defer unlock()

	limit := s.maxStateBytes
	if upload.Kind == "battery" {
		limit = s.maxBatteryBytes
	}
	stored, err := s.blobs.Put(ctx, upload.Body, limit, upload.ExpectedSHA256)
	if err != nil {
		return CommitResult{}, err
	}
	requestHash := requestDigest(userID, upload.Key, upload.BaseRevision, stored.Digest, upload.CoreBuildID, upload.DeviceID)
	return s.repository.Commit(ctx, CommitInput{
		UserID: userID, Key: upload.Key, BaseRevision: upload.BaseRevision,
		Checksum: stored.Digest, BlobDigest: stored.Digest, SizeBytes: stored.Size,
		CoreBuildID: upload.CoreBuildID, DeviceID: upload.DeviceID,
		IdempotencyKey: upload.IdempotencyKey, RequestHash: requestHash,
	})
}

func (s *Service) Restore(ctx context.Context, userID string, input RestoreInput) (CommitResult, error) {
	if err := validateKey(input.Key); err != nil {
		return CommitResult{}, err
	}
	if input.SourceRevision <= 0 || input.BaseRevision < 0 {
		return CommitResult{}, errors.New("source revision must be positive and base revision cannot be negative")
	}
	if !uuidPattern.MatchString(input.IdempotencyKey) {
		return CommitResult{}, errors.New("Idempotency-Key must be a UUID")
	}
	input.UserID = userID
	input.RequestHash = requestDigest(userID, input.Key, input.BaseRevision, fmt.Sprint(input.SourceRevision), "restore", input.DeviceID)
	return s.repository.Restore(ctx, input)
}

func (s *Service) List(ctx context.Context, userID, romID string) ([]Head, error) {
	if userID == "" {
		return nil, errors.New("user ID is required")
	}
	if romID != "" && !hex64Pattern.MatchString(romID) {
		return nil, errors.New("ROM ID must be a lowercase SHA-256 digest")
	}
	return s.repository.List(ctx, userID, romID)
}

func (s *Service) ListVersions(ctx context.Context, userID string, key Key) ([]Version, error) {
	if userID == "" {
		return nil, errors.New("user ID is required")
	}
	if err := validateKey(key); err != nil {
		return nil, err
	}
	return s.repository.ListVersions(ctx, userID, key)
}

func (s *Service) Content(ctx context.Context, userID string, key Key, revision int64) (Content, error) {
	if err := validateKey(key); err != nil {
		return Content{}, err
	}
	if revision < 0 {
		return Content{}, errors.New("revision cannot be negative")
	}
	return s.repository.GetContent(ctx, userID, key, revision)
}

func (s *Service) OpenBlob(ctx context.Context, digest string) (ReadSeekCloser, error) {
	return s.blobs.Open(ctx, digest)
}

func (s *Service) DeleteHead(ctx context.Context, userID string, key Key) error {
	if err := validateKey(key); err != nil {
		return err
	}
	return s.repository.DeleteHead(ctx, userID, key)
}

func (s *Service) DeleteROM(ctx context.Context, userID, romID string) error {
	if !hex64Pattern.MatchString(romID) {
		return errors.New("ROM ID must be a lowercase SHA-256 digest")
	}
	return s.repository.DeleteROM(ctx, userID, romID)
}

type ReadSeekCloser interface {
	Read([]byte) (int, error)
	Seek(int64, int) (int64, error)
	Close() error
}

func validateKey(key Key) error {
	if !hex64Pattern.MatchString(key.ROMID) {
		return errors.New("ROM ID must be a lowercase SHA-256 digest")
	}
	if key.Kind != "battery" && key.Kind != "state" && key.Kind != "auto_state" {
		return errors.New("save kind must be battery, state, or auto_state")
	}
	if !slotPattern.MatchString(key.Slot) {
		return errors.New("save slot is invalid")
	}
	if key.Kind == "battery" && key.Slot != "current" {
		return errors.New("battery save slot must be current")
	}
	if key.Kind == "state" && key.Slot != "0" && key.Slot != "1" && key.Slot != "2" && key.Slot != "3" && key.Slot != "4" {
		return errors.New("state save slot must be 0 through 4")
	}
	if key.Kind == "auto_state" && key.Slot != "auto" {
		return errors.New("automatic state slot must be auto")
	}
	return nil
}

func requestDigest(parts ...any) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = fmt.Fprint(hash, len(fmt.Sprint(part)), ":", part, "\n")
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func normalizeCoreBuildID(value string) string { return strings.TrimSpace(value) }
