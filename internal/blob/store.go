package blob

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sync"
)

var (
	ErrTooLarge         = errors.New("blob exceeds size limit")
	ErrChecksumMismatch = errors.New("blob checksum does not match header")
	digestPattern       = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type PutResult struct {
	Digest string
	Size   int64
	Path   string
}

type Store interface {
	Put(context.Context, io.Reader, int64, string) (PutResult, error)
	Open(context.Context, string) (*os.File, error)
	LockDigest(string) (func(), error)
}

type FSStore struct {
	root  string
	temp  string
	locks sync.Map
}

func (s *FSStore) LockDigest(digest string) (func(), error) {
	if !digestPattern.MatchString(digest) {
		return nil, errors.New("invalid blob digest")
	}
	value, _ := s.locks.LoadOrStore(digest, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock, nil
}

func NewFSStore(root, temp string) (*FSStore, error) {
	if root == "" || temp == "" {
		return nil, errors.New("blob and temporary roots are required")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve blob root: %w", err)
	}
	absTemp, err := filepath.Abs(temp)
	if err != nil {
		return nil, fmt.Errorf("resolve temporary root: %w", err)
	}
	for _, path := range []string{absRoot, absTemp} {
		if err := os.MkdirAll(path, 0o750); err != nil {
			return nil, fmt.Errorf("create storage directory: %w", err)
		}
	}
	return &FSStore{root: absRoot, temp: absTemp}, nil
}

func (s *FSStore) Put(ctx context.Context, src io.Reader, maxBytes int64, expectedDigest string) (PutResult, error) {
	if maxBytes <= 0 {
		return PutResult{}, errors.New("maximum blob size must be positive")
	}
	if expectedDigest != "" && !digestPattern.MatchString(expectedDigest) {
		return PutResult{}, errors.New("invalid expected digest")
	}
	temp, err := os.CreateTemp(s.temp, "upload-*.part")
	if err != nil {
		return PutResult{}, fmt.Errorf("create temporary blob: %w", err)
	}
	tempPath := temp.Name()
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o640); err != nil {
		return PutResult{}, fmt.Errorf("set temporary blob permissions: %w", err)
	}

	hash := sha256.New()
	limited := io.LimitReader(&contextReader{ctx: ctx, reader: src}, maxBytes+1)
	size, err := io.Copy(io.MultiWriter(temp, hash), limited)
	if err != nil {
		return PutResult{}, fmt.Errorf("write temporary blob: %w", err)
	}
	if size > maxBytes {
		return PutResult{}, ErrTooLarge
	}
	if size == 0 {
		return PutResult{}, errors.New("empty blobs are not accepted")
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if expectedDigest != "" && digest != expectedDigest {
		return PutResult{}, ErrChecksumMismatch
	}
	if err := temp.Sync(); err != nil {
		return PutResult{}, fmt.Errorf("sync temporary blob: %w", err)
	}
	if err := temp.Close(); err != nil {
		return PutResult{}, fmt.Errorf("close temporary blob: %w", err)
	}

	target := s.path(digest)
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return PutResult{}, fmt.Errorf("create blob shard: %w", err)
	}
	if err := os.Link(tempPath, target); err != nil {
		if _, statErr := os.Stat(target); statErr != nil {
			return PutResult{}, fmt.Errorf("commit blob: %w", err)
		}
	}
	if err := os.Remove(tempPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return PutResult{}, fmt.Errorf("remove temporary blob link: %w", err)
	}
	committed = true
	if err := syncDir(filepath.Dir(target)); err != nil {
		return PutResult{}, fmt.Errorf("sync blob shard: %w", err)
	}
	return PutResult{Digest: digest, Size: size, Path: target}, nil
}

func (s *FSStore) Open(_ context.Context, digest string) (*os.File, error) {
	if !digestPattern.MatchString(digest) {
		return nil, errors.New("invalid blob digest")
	}
	file, err := os.Open(s.path(digest))
	if err != nil {
		return nil, fmt.Errorf("open blob: %w", err)
	}
	return file, nil
}

func (s *FSStore) Delete(_ context.Context, digest string) error {
	if !digestPattern.MatchString(digest) {
		return errors.New("invalid blob digest")
	}
	err := os.Remove(s.path(digest))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete blob: %w", err)
	}
	return nil
}

func (s *FSStore) path(digest string) string {
	return filepath.Join(s.root, digest[:2], digest[2:4], digest)
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(p)
	}
}

func syncDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
