package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/minigba-cloud/minigba-api/internal/account"
	"github.com/minigba-cloud/minigba-api/internal/auth"
	"github.com/minigba-cloud/minigba-api/internal/blob"
	"github.com/minigba-cloud/minigba-api/internal/save"
)

const (
	httpTestROM    = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	httpTestUUID   = "123e4567-e89b-42d3-a456-426614174000"
	httpTestUserID = "223e4567-e89b-42d3-a456-426614174000"
)

type fakeAccounts struct{ active bool }

func (f *fakeAccounts) Login(context.Context, string, string, string, time.Time) (account.LoginResult, error) {
	f.active = true
	return account.LoginResult{UserID: httpTestUserID, DeviceID: httpTestUUID, SessionID: httpTestUUID}, nil
}
func (f *fakeAccounts) SessionActive(context.Context, string, string) (bool, error) {
	return f.active, nil
}
func (f *fakeAccounts) RefreshSession(context.Context, string, string, time.Time) error { return nil }
func (f *fakeAccounts) RevokeSession(context.Context, string, string) error {
	f.active = false
	return nil
}
func (f *fakeAccounts) RequestDeletion(context.Context, string) (account.DeletionStatus, error) {
	f.active = false
	return account.DeletionStatus{JobID: httpTestUUID, Status: "pending"}, nil
}
func (*fakeAccounts) DeletionStatus(context.Context, string) (account.DeletionStatus, error) {
	return account.DeletionStatus{JobID: httpTestUUID, Status: "pending"}, nil
}

type fakeSaves struct{}

func (*fakeSaves) Commit(_ context.Context, input save.CommitInput) (save.CommitResult, error) {
	return save.CommitResult{Version: save.Version{Key: input.Key, Revision: input.BaseRevision + 1, Checksum: input.Checksum, SizeBytes: input.SizeBytes, CoreBuildID: input.CoreBuildID, DeviceID: input.DeviceID, CreatedAt: time.Unix(1700000000, 0)}}, nil
}
func (*fakeSaves) Restore(context.Context, save.RestoreInput) (save.CommitResult, error) {
	return save.CommitResult{}, nil
}
func (*fakeSaves) List(context.Context, string, string) ([]save.Head, error) {
	return []save.Head{}, nil
}
func (*fakeSaves) ListVersions(context.Context, string, save.Key) ([]save.Version, error) {
	return []save.Version{}, nil
}
func (*fakeSaves) GetContent(context.Context, string, save.Key, int64) (save.Content, error) {
	return save.Content{}, save.ErrNotFound
}
func (*fakeSaves) DeleteHead(context.Context, string, save.Key) error { return nil }
func (*fakeSaves) DeleteROM(context.Context, string, string) error    { return nil }

func newTestHandler(t *testing.T) (http.Handler, *fakeAccounts) {
	t.Helper()
	accounts := &fakeAccounts{}
	fs, err := blob.NewFSStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	saves, err := save.NewService(&fakeSaves{}, fs, 1024, 2048)
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("01234567890123456789012345678901")
	tokens, err := auth.NewTokenManager(key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(accounts, saves, auth.DevelopmentWechatClient{}, tokens, key, func(context.Context) error { return nil }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return server.Handler(), accounts
}

func TestLoginAuthenticationAndUpload(t *testing.T) {
	handler, _ := newTestHandler(t)
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/saves", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.Code)
	}

	loginBody := bytes.NewBufferString(`{"code":"local-user","clientDeviceId":"` + httpTestUUID + `","deviceName":"Test Phone"}`)
	login := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/wechat/login", loginBody)
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(login, req)
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	var loginResponse struct {
		AccessToken string `json:"accessToken"`
		UserID      string `json:"userId"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &loginResponse); err != nil {
		t.Fatal(err)
	}
	if loginResponse.AccessToken == "" {
		t.Fatal("missing access token")
	}
	if loginResponse.UserID != httpTestUserID {
		t.Fatalf("userId = %q", loginResponse.UserID)
	}

	body := []byte("save-content")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	uploadURL := "/v1/saves/" + httpTestROM + "/battery/current"
	missingPrecondition := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+loginResponse.AccessToken)
	handler.ServeHTTP(missingPrecondition, req)
	if missingPrecondition.Code != http.StatusPreconditionRequired {
		t.Fatalf("precondition status = %d", missingPrecondition.Code)
	}

	upload := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+loginResponse.AccessToken)
	req.Header.Set("If-Match", `"revision-0"`)
	req.Header.Set("X-Content-SHA256", digest)
	req.Header.Set("X-Core-Build-ID", "test-core")
	req.Header.Set("X-Device-ID", httpTestUUID)
	req.Header.Set("Idempotency-Key", httpTestUUID)
	handler.ServeHTTP(upload, req)
	if upload.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body=%s", upload.Code, upload.Body.String())
	}
	if upload.Header().Get("ETag") != `"revision-1"` {
		t.Fatalf("ETag = %q", upload.Header().Get("ETag"))
	}
}

func TestHomeAndReadiness(t *testing.T) {
	handler, _ := newTestHandler(t)
	for _, path := range []string{"/", "/health/live", "/health/ready"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d", path, rec.Code)
		}
	}
}

func TestRefreshVersionsAndDeletionStatus(t *testing.T) {
	handler, _ := newTestHandler(t)
	token := loginToken(t, handler)

	refresh := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/refresh", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(refresh, req)
	if refresh.Code != http.StatusOK || !bytes.Contains(refresh.Body.Bytes(), []byte(`"accessToken"`)) {
		t.Fatalf("refresh status=%d body=%s", refresh.Code, refresh.Body.String())
	}

	versions := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/saves/"+httpTestROM+"/battery/current/versions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(versions, req)
	if versions.Code != http.StatusOK || !bytes.Contains(versions.Body.Bytes(), []byte(`"versions"`)) {
		t.Fatalf("versions status=%d body=%s", versions.Code, versions.Body.String())
	}

	deletion := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/v1/account/deletion", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Confirm-Account-Deletion", "DELETE")
	handler.ServeHTTP(deletion, req)
	if deletion.Code != http.StatusAccepted {
		t.Fatalf("deletion status=%d body=%s", deletion.Code, deletion.Body.String())
	}

	status := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/v1/account/deletion", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(status, req)
	if status.Code != http.StatusOK || !bytes.Contains(status.Body.Bytes(), []byte(`"pending"`)) {
		t.Fatalf("deletion query status=%d body=%s", status.Code, status.Body.String())
	}
}

func loginToken(t *testing.T, handler http.Handler) string {
	t.Helper()
	login := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/wechat/login", bytes.NewBufferString(`{"code":"local-user","clientDeviceId":"`+httpTestUUID+`","deviceName":"Test Phone"}`))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(login, req)
	if login.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
	}
	var body struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal(login.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.AccessToken
}
