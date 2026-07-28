package blob

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"
)

func TestFSStorePutOpenAndDeduplicate(t *testing.T) {
	root, temp := t.TempDir(), t.TempDir()
	store, err := NewFSStore(root, temp)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("mini-gba-save")
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])
	for i := 0; i < 2; i++ {
		result, err := store.Put(context.Background(), bytes.NewReader(content), 1024, digest)
		if err != nil {
			t.Fatal(err)
		}
		if result.Digest != digest || result.Size != int64(len(content)) {
			t.Fatalf("wrong result: %+v", result)
		}
	}
	file, err := store.Open(context.Background(), digest)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	got, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("content = %q", got)
	}
}

func TestFSStoreRejectsBadInput(t *testing.T) {
	store, err := NewFSStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), bytes.NewReader([]byte("too large")), 2, ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large error = %v", err)
	}
	wrong := string(bytes.Repeat([]byte{'0'}, 64))
	if _, err := store.Put(context.Background(), bytes.NewReader([]byte("x")), 2, wrong); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("checksum error = %v", err)
	}
	if _, err := store.Open(context.Background(), "../../etc/passwd"); err == nil {
		t.Fatal("path traversal digest accepted")
	}
}
