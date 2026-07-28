package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/minigba-cloud/minigba-api/internal/account"
	"github.com/minigba-cloud/minigba-api/internal/auth"
	"github.com/minigba-cloud/minigba-api/internal/blob"
	"github.com/minigba-cloud/minigba-api/internal/buildinfo"
	"github.com/minigba-cloud/minigba-api/internal/ids"
	"github.com/minigba-cloud/minigba-api/internal/save"
)

type Server struct {
	accounts       account.Repository
	saves          *save.Service
	wechat         auth.WechatClient
	tokens         *auth.TokenManager
	subjectHashKey []byte
	ready          func(context.Context) error
	logger         *slog.Logger
	startedAt      time.Time
}

func New(accounts account.Repository, saves *save.Service, wechat auth.WechatClient, tokens *auth.TokenManager, subjectHashKey []byte, ready func(context.Context) error, logger *slog.Logger) (*Server, error) {
	if accounts == nil || saves == nil || wechat == nil || tokens == nil || ready == nil {
		return nil, errors.New("HTTP server dependencies are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{accounts: accounts, saves: saves, wechat: wechat, tokens: tokens, subjectHashKey: append([]byte(nil), subjectHashKey...), ready: ready, logger: logger, startedAt: time.Now().UTC()}, nil
}

func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serveHTTP) }

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	requestID := requestID(r)
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
	defer func() {
		if recovered := recover(); recovered != nil {
			s.logger.Error("request panic", "requestId", requestID, "method", r.Method)
			writeError(recorder, requestID, http.StatusInternalServerError, "INTERNAL_ERROR", "The service could not process the request", nil)
		}
		s.logger.Info("request", "requestId", requestID, "method", r.Method, "route", routeLabel(r.URL.Path), "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
	}()

	if r.Method == http.MethodGet && r.URL.Path == "/" {
		s.home(recorder, r)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/health/live" {
		writeJSON(recorder, http.StatusOK, map[string]any{"status": "ok"})
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/health/ready" {
		s.readiness(recorder, r, requestID)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/auth/wechat/login" {
		s.login(recorder, r, requestID)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/v1/account/deletion" {
		s.deletionStatus(recorder, r, requestID)
		return
	}

	claims, ok := s.authenticate(recorder, r, requestID)
	if !ok {
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/auth/logout" {
		s.logout(recorder, r, requestID, claims)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/auth/refresh" {
		s.refresh(recorder, r, requestID, claims)
		return
	}
	if (r.Method == http.MethodPost && r.URL.Path == "/v1/account/deletion") || (r.Method == http.MethodDelete && r.URL.Path == "/v1/account") {
		s.deleteAccount(recorder, r, requestID, claims)
		return
	}
	s.routeSaves(recorder, r, requestID, claims)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request, requestID string, claims auth.Claims) {
	expiresAt := s.tokens.NextExpiry()
	if err := s.accounts.RefreshSession(r.Context(), claims.UserID, claims.SessionID, expiresAt); err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "SESSION_REVOKED", "The session cannot be refreshed", nil)
		return
	}
	token, expiresAt, err := s.tokens.Issue(claims.UserID, claims.SessionID)
	if err != nil {
		writeError(w, requestID, http.StatusInternalServerError, "REFRESH_FAILED", "A new access token could not be issued", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accessToken": token, "tokenType": "Bearer", "expiresAt": expiresAt, "userId": claims.UserID})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request, requestID string) {
	var body struct{ Code, ClientDeviceID, DeviceName string }
	if err := decodeJSON(w, r, 16<<10, &body); err != nil {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_REQUEST", err.Error(), nil)
		return
	}
	if !ids.IsUUID(body.ClientDeviceID) {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_DEVICE_ID", "clientDeviceId must be a UUID", nil)
		return
	}
	body.DeviceName = strings.TrimSpace(body.DeviceName)
	if len(body.DeviceName) == 0 || len(body.DeviceName) > 80 {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_DEVICE_NAME", "deviceName must contain 1 to 80 characters", nil)
		return
	}
	identity, err := s.wechat.Exchange(r.Context(), body.Code)
	if err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "WECHAT_LOGIN_FAILED", "WeChat login could not be completed", nil)
		return
	}
	login, err := s.accounts.Login(r.Context(), auth.SubjectHash(s.subjectHashKey, identity.OpenID), body.ClientDeviceID, body.DeviceName, s.tokens.NextExpiry())
	if err != nil {
		if errors.Is(err, account.ErrUnavailable) {
			writeError(w, requestID, http.StatusForbidden, "ACCOUNT_UNAVAILABLE", "The account is not active", nil)
			return
		}
		writeError(w, requestID, http.StatusInternalServerError, "LOGIN_FAILED", "The session could not be created", nil)
		return
	}
	token, expires, err := s.tokens.Issue(login.UserID, login.SessionID)
	if err != nil {
		writeError(w, requestID, http.StatusInternalServerError, "LOGIN_FAILED", "The session could not be created", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accessToken": token, "tokenType": "Bearer", "expiresAt": expires, "deviceId": login.DeviceID, "userId": login.UserID})
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request, requestID string) (auth.Claims, bool) {
	token, err := auth.BearerToken(r.Header.Get("Authorization"))
	if err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "AUTH_REQUIRED", "A valid bearer token is required", nil)
		return auth.Claims{}, false
	}
	claims, err := s.tokens.Parse(token)
	if err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "INVALID_TOKEN", "The session token is invalid or expired", nil)
		return auth.Claims{}, false
	}
	active, err := s.accounts.SessionActive(r.Context(), claims.UserID, claims.SessionID)
	if err != nil {
		writeError(w, requestID, http.StatusServiceUnavailable, "AUTH_UNAVAILABLE", "Session validation is temporarily unavailable", nil)
		return auth.Claims{}, false
	}
	if !active {
		writeError(w, requestID, http.StatusUnauthorized, "SESSION_REVOKED", "The session is no longer active", nil)
		return auth.Claims{}, false
	}
	return claims, true
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, requestID string, claims auth.Claims) {
	if err := s.accounts.RevokeSession(r.Context(), claims.UserID, claims.SessionID); err != nil {
		writeError(w, requestID, http.StatusInternalServerError, "LOGOUT_FAILED", "The session could not be revoked", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, requestID string, claims auth.Claims) {
	if r.Header.Get("X-Confirm-Account-Deletion") != "DELETE" {
		writeError(w, requestID, http.StatusBadRequest, "CONFIRMATION_REQUIRED", "X-Confirm-Account-Deletion must be DELETE", nil)
		return
	}
	status, err := s.accounts.RequestDeletion(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, requestID, http.StatusInternalServerError, "DELETE_FAILED", "Account deletion could not be queued", nil)
		return
	}
	writeJSON(w, http.StatusAccepted, status)
}

func (s *Server) deletionStatus(w http.ResponseWriter, r *http.Request, requestID string) {
	token, err := auth.BearerToken(r.Header.Get("Authorization"))
	if err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "AUTH_REQUIRED", "A valid bearer token is required", nil)
		return
	}
	claims, err := s.tokens.Parse(token)
	if err != nil {
		writeError(w, requestID, http.StatusUnauthorized, "INVALID_TOKEN", "The deletion receipt token is invalid or expired", nil)
		return
	}
	status, err := s.accounts.DeletionStatus(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, requestID, http.StatusNotFound, "NOT_FOUND", "No account deletion request exists", nil)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) routeSaves(w http.ResponseWriter, r *http.Request, requestID string, claims auth.Claims) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "v1" || parts[1] != "saves" {
		writeError(w, requestID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found", nil)
		return
	}
	if len(parts) == 2 && r.Method == http.MethodGet {
		s.listSaves(w, r, requestID, claims.UserID, "")
		return
	}
	if len(parts) == 3 {
		if r.Method == http.MethodGet {
			s.listSaves(w, r, requestID, claims.UserID, parts[2])
			return
		}
		if r.Method == http.MethodDelete {
			s.deleteROM(w, r, requestID, claims.UserID, parts[2])
			return
		}
	}
	if len(parts) < 5 {
		writeError(w, requestID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found", nil)
		return
	}
	key := save.Key{ROMID: parts[2], Kind: parts[3], Slot: parts[4]}
	if len(parts) == 5 {
		if r.Method == http.MethodPut {
			s.upload(w, r, requestID, claims.UserID, key)
			return
		}
		if r.Method == http.MethodDelete {
			s.deleteHead(w, r, requestID, claims.UserID, key)
			return
		}
	}
	if len(parts) == 6 && parts[5] == "content" && r.Method == http.MethodGet {
		s.download(w, r, requestID, claims.UserID, key, 0)
		return
	}
	if len(parts) == 6 && parts[5] == "restore" && r.Method == http.MethodPost {
		s.restore(w, r, requestID, claims.UserID, key)
		return
	}
	if len(parts) == 6 && parts[5] == "versions" && r.Method == http.MethodGet {
		s.listVersions(w, r, requestID, claims.UserID, key)
		return
	}
	if len(parts) == 7 && parts[5] == "versions" && r.Method == http.MethodGet {
		revision, err := strconv.ParseInt(parts[6], 10, 64)
		if err != nil || revision <= 0 {
			writeError(w, requestID, http.StatusBadRequest, "INVALID_REVISION", "revision must be a positive integer", nil)
			return
		}
		s.download(w, r, requestID, claims.UserID, key, revision)
		return
	}
	writeError(w, requestID, http.StatusNotFound, "NOT_FOUND", "The requested resource was not found", nil)
}

func (s *Server) listVersions(w http.ResponseWriter, r *http.Request, requestID, userID string, key save.Key) {
	items, err := s.saves.ListVersions(r.Context(), userID, key)
	if err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": items})
}

func (s *Server) listSaves(w http.ResponseWriter, r *http.Request, requestID, userID, romID string) {
	items, err := s.saves.List(r.Context(), userID, romID)
	if err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"saves": items})
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request, requestID, userID string, key save.Key) {
	ifMatch := r.Header.Get("If-Match")
	if ifMatch == "" {
		writeError(w, requestID, http.StatusPreconditionRequired, "IF_MATCH_REQUIRED", "If-Match is required", nil)
		return
	}
	base, err := auth.ParseRevisionETag(ifMatch)
	if err != nil {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_REVISION", err.Error(), nil)
		return
	}
	result, err := s.saves.Upload(r.Context(), userID, save.Upload{Key: key, BaseRevision: base, ExpectedSHA256: r.Header.Get("X-Content-SHA256"), CoreBuildID: r.Header.Get("X-Core-Build-ID"), DeviceID: r.Header.Get("X-Device-ID"), IdempotencyKey: r.Header.Get("Idempotency-Key"), Body: r.Body})
	if err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	w.Header().Set("ETag", auth.RevisionETag(result.Version.Revision))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) download(w http.ResponseWriter, r *http.Request, requestID, userID string, key save.Key, revision int64) {
	content, err := s.saves.Content(r.Context(), userID, key, revision)
	if err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	file, err := s.saves.OpenBlob(r.Context(), content.BlobDigest)
	if err != nil {
		writeError(w, requestID, http.StatusInternalServerError, "BLOB_UNAVAILABLE", "The save content is temporarily unavailable", nil)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(content.SizeBytes, 10))
	w.Header().Set("ETag", auth.RevisionETag(content.Revision))
	w.Header().Set("X-Content-SHA256", content.Checksum)
	w.Header().Set("X-Revision", strconv.FormatInt(content.Revision, 10))
	w.Header().Set("X-Core-Build-ID", content.CoreBuildID)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, file); err != nil {
		s.logger.Warn("save download interrupted", "requestId", requestID)
	}
}

func (s *Server) restore(w http.ResponseWriter, r *http.Request, requestID, userID string, key save.Key) {
	base, err := auth.ParseRevisionETag(r.Header.Get("If-Match"))
	if err != nil || r.Header.Get("If-Match") == "" {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_REVISION", "A valid If-Match revision is required", nil)
		return
	}
	var body struct {
		Revision int64 `json:"revision"`
	}
	if err := decodeJSON(w, r, 8<<10, &body); err != nil {
		writeError(w, requestID, http.StatusBadRequest, "INVALID_REQUEST", err.Error(), nil)
		return
	}
	result, err := s.saves.Restore(r.Context(), userID, save.RestoreInput{Key: key, SourceRevision: body.Revision, BaseRevision: base, DeviceID: r.Header.Get("X-Device-ID"), IdempotencyKey: r.Header.Get("Idempotency-Key")})
	if err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	w.Header().Set("ETag", auth.RevisionETag(result.Version.Revision))
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) deleteHead(w http.ResponseWriter, r *http.Request, requestID, userID string, key save.Key) {
	if err := s.saves.DeleteHead(r.Context(), userID, key); err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) deleteROM(w http.ResponseWriter, r *http.Request, requestID, userID, romID string) {
	if err := s.saves.DeleteROM(r.Context(), userID, romID); err != nil {
		writeDomainError(w, requestID, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) readiness(w http.ResponseWriter, r *http.Request, requestID string) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.ready(ctx); err != nil {
		writeError(w, requestID, http.StatusServiceUnavailable, "NOT_READY", "A required dependency is unavailable", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func (s *Server) home(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, fmt.Sprintf(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MiniGBA Cloud</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101415;color:#eef4f1;font:15px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}main{width:min(760px,calc(100%% - 40px));margin:12vh auto;border-top:4px solid #21b6a8;padding-top:28px}h1{font:700 42px/1.1 system-ui,sans-serif;letter-spacing:0;margin:0 0 14px}.signal{color:#21b6a8}.meta{margin-top:36px;padding:18px 0;border-top:1px solid #34403d;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.label{color:#8c9b96;font-size:12px;text-transform:uppercase}.value{display:block;margin-top:4px;color:#fff}@media(max-width:560px){h1{font-size:32px}.meta{grid-template-columns:1fr}}</style></head><body><main><div class="signal">● SERVICE ONLINE</div><h1>MiniGBA Cloud Save API</h1><p>微信小程序的版本化存档服务。ROM 内容不会上传到此服务。</p><div class="meta"><div><span class="label">Version</span><span class="value">%s</span></div><div><span class="label">Commit</span><span class="value">%s</span></div><div><span class="label">Uptime</span><span class="value">%s</span></div></div></main></body></html>`, htmlEscape(buildinfo.Version), htmlEscape(buildinfo.Commit), time.Since(s.startedAt).Round(time.Second)))
}

func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func writeError(w http.ResponseWriter, requestID string, status int, code, message string, details any) {
	payload := map[string]any{"code": code, "message": message, "requestId": requestID}
	if details != nil {
		payload["details"] = details
	}
	writeJSON(w, status, map[string]any{"error": payload})
}
func writeDomainError(w http.ResponseWriter, requestID string, err error) {
	var conflict *save.ConflictError
	switch {
	case errors.As(err, &conflict):
		writeError(w, requestID, http.StatusConflict, "SAVE_CONFLICT", "Cloud save has changed", conflict.Current)
	case errors.Is(err, save.ErrNotFound):
		writeError(w, requestID, http.StatusNotFound, "NOT_FOUND", "The requested save was not found", nil)
	case errors.Is(err, save.ErrIdempotencyKey):
		writeError(w, requestID, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for another request", nil)
	case errors.Is(err, save.ErrQuotaExceeded):
		writeError(w, requestID, http.StatusRequestEntityTooLarge, "QUOTA_EXCEEDED", "Cloud save quota exceeded", nil)
	case errors.Is(err, blob.ErrTooLarge):
		writeError(w, requestID, http.StatusRequestEntityTooLarge, "SAVE_TOO_LARGE", "The save exceeds its size limit", nil)
	case errors.Is(err, blob.ErrChecksumMismatch):
		writeError(w, requestID, http.StatusBadRequest, "CHECKSUM_MISMATCH", "The save content does not match X-Content-SHA256", nil)
	default:
		if strings.Contains(err.Error(), "must") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "accepted") {
			writeError(w, requestID, http.StatusBadRequest, "INVALID_REQUEST", err.Error(), nil)
		} else {
			writeError(w, requestID, http.StatusInternalServerError, "INTERNAL_ERROR", "The service could not process the request", nil)
		}
	}
}
func requestID(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if ids.IsUUID(value) {
		return value
	}
	id, err := ids.NewUUID()
	if err != nil {
		return fmt.Sprint(time.Now().UnixNano())
	}
	return id
}
func routeLabel(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if len(p) == 64 {
			parts[i] = "{romId}"
		} else if i > 0 && parts[i-1] == "versions" {
			parts[i] = "{revision}"
		}
	}
	if len(parts) == 0 || parts[0] == "" {
		return "/"
	}
	return "/" + strings.Join(parts, "/")
}
func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return replacer.Replace(value)
}

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
