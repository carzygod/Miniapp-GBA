package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

type Claims struct {
	UserID    string `json:"sub"`
	SessionID string `json:"sid"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

type TokenManager struct {
	key []byte
	ttl time.Duration
	now func() time.Time
}

func NewTokenManager(key []byte, ttl time.Duration) (*TokenManager, error) {
	if len(key) < 32 {
		return nil, errors.New("token key must contain at least 32 bytes")
	}
	if ttl <= 0 {
		return nil, errors.New("token TTL must be positive")
	}
	copyKey := append([]byte(nil), key...)
	return &TokenManager{key: copyKey, ttl: ttl, now: time.Now}, nil
}

func (m *TokenManager) Issue(userID, sessionID string) (string, time.Time, error) {
	if userID == "" || sessionID == "" {
		return "", time.Time{}, errors.New("user and session IDs are required")
	}
	now := m.now().UTC()
	expires := now.Add(m.ttl)
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payloadBytes, err := json.Marshal(Claims{UserID: userID, SessionID: sessionID, IssuedAt: now.Unix(), ExpiresAt: expires.Unix()})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("encode claims: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signed := header + "." + payload
	return signed + "." + m.signature(signed), expires, nil
}

func (m *TokenManager) NextExpiry() time.Time { return m.now().UTC().Add(m.ttl) }

func (m *TokenManager) Parse(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	signed := parts[0] + "." + parts[1]
	expected, err := base64.RawURLEncoding.DecodeString(m.signature(signed))
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	actual, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(actual, expected) {
		return Claims{}, ErrInvalidToken
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || string(headerBytes) != `{"alg":"HS256","typ":"JWT"}` {
		return Claims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if claims.UserID == "" || claims.SessionID == "" || claims.IssuedAt <= 0 || claims.ExpiresAt <= claims.IssuedAt {
		return Claims{}, ErrInvalidToken
	}
	if m.now().Unix() >= claims.ExpiresAt {
		return Claims{}, ErrExpiredToken
	}
	return claims, nil
}

func (m *TokenManager) signature(message string) string {
	mac := hmac.New(sha256.New, m.key)
	_, _ = mac.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func SubjectHash(key []byte, openID string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("wechat-subject-v1:" + openID))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func BearerToken(header string) (string, error) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", ErrInvalidToken
	}
	return parts[1], nil
}

func RevisionETag(revision int64) string { return `"revision-` + strconv.FormatInt(revision, 10) + `"` }

func ParseRevisionETag(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "*" {
		return 0, nil
	}
	if len(value) < 12 || value[0] != '"' || value[len(value)-1] != '"' || !strings.HasPrefix(value[1:], "revision-") {
		return 0, errors.New("invalid revision ETag")
	}
	revision, err := strconv.ParseInt(value[len(`"revision-`):len(value)-1], 10, 64)
	if err != nil || revision < 0 {
		return 0, errors.New("invalid revision ETag")
	}
	return revision, nil
}
