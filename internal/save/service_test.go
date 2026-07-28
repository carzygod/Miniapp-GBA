package save

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/minigba-cloud/minigba-api/internal/blob"
)

const (
	testROM  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testUUID = "123e4567-e89b-42d3-a456-426614174000"
)

type fakeRepository struct {
	commitInput CommitInput
	commit      func(CommitInput) (CommitResult, error)
}

func (f *fakeRepository) Commit(_ context.Context, input CommitInput) (CommitResult, error) {
	f.commitInput = input
	if f.commit != nil {
		return f.commit(input)
	}
	return CommitResult{Version: Version{Key: input.Key, Revision: input.BaseRevision + 1, Checksum: input.Checksum, SizeBytes: input.SizeBytes}}, nil
}
func (*fakeRepository) Restore(context.Context, RestoreInput) (CommitResult, error) {
	return CommitResult{}, nil
}
func (*fakeRepository) List(context.Context, string, string) ([]Head, error)         { return nil, nil }
func (*fakeRepository) ListVersions(context.Context, string, Key) ([]Version, error) { return nil, nil }
func (*fakeRepository) GetContent(context.Context, string, Key, int64) (Content, error) {
	return Content{}, nil
}
func (*fakeRepository) DeleteHead(context.Context, string, Key) error   { return nil }
func (*fakeRepository) DeleteROM(context.Context, string, string) error { return nil }

func TestUploadStoresVerifiedContentAndCommits(t *testing.T) {
	repo := &fakeRepository{}
	store, err := blob.NewFSStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(repo, store, 1024, 2048)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("battery-save")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	result, err := service.Upload(context.Background(), "user", Upload{
		Key: Key{ROMID: testROM, Kind: "battery", Slot: "current"}, BaseRevision: 3,
		ExpectedSHA256: digest, CoreBuildID: " build-1 ", DeviceID: testUUID,
		IdempotencyKey: testUUID, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Version.Revision != 4 {
		t.Fatalf("revision = %d", result.Version.Revision)
	}
	if repo.commitInput.Checksum != digest || repo.commitInput.SizeBytes != int64(len(body)) {
		t.Fatalf("commit input = %+v", repo.commitInput)
	}
	if repo.commitInput.CoreBuildID != "build-1" {
		t.Fatalf("core build ID = %q", repo.commitInput.CoreBuildID)
	}
	if len(repo.commitInput.RequestHash) != 64 {
		t.Fatalf("request hash = %q", repo.commitInput.RequestHash)
	}
}

func TestUploadRejectsInvalidInputsBeforeCommit(t *testing.T) {
	repo := &fakeRepository{}
	store, _ := blob.NewFSStore(t.TempDir(), t.TempDir())
	service, _ := NewService(repo, store, 4, 8)
	valid := Upload{Key: Key{ROMID: testROM, Kind: "battery", Slot: "current"}, ExpectedSHA256: string(bytes.Repeat([]byte{'0'}, 64)), CoreBuildID: "b", IdempotencyKey: testUUID, Body: bytes.NewReader([]byte("12345"))}
	if _, err := service.Upload(context.Background(), "user", valid); !errors.Is(err, blob.ErrTooLarge) {
		t.Fatalf("size error = %v", err)
	}
	valid.Body = bytes.NewReader([]byte("1234"))
	if _, err := service.Upload(context.Background(), "user", valid); !errors.Is(err, blob.ErrChecksumMismatch) {
		t.Fatalf("checksum error = %v", err)
	}
	valid.Key.ROMID = "../escape"
	if _, err := service.Upload(context.Background(), "user", valid); err == nil {
		t.Fatal("invalid ROM ID accepted")
	}
}
