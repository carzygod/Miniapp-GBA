package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WechatIdentity struct {
	OpenID  string
	UnionID string
}

type WechatClient interface {
	Exchange(context.Context, string) (WechatIdentity, error)
}

type HTTPWechatClient struct {
	appID      string
	appSecret  string
	httpClient *http.Client
	endpoint   string
}

func NewHTTPWechatClient(appID, appSecret string) *HTTPWechatClient {
	return &HTTPWechatClient{
		appID: appID, appSecret: appSecret,
		httpClient: &http.Client{Timeout: 8 * time.Second},
		endpoint:   "https://api.weixin.qq.com/sns/jscode2session",
	}
}

func (c *HTTPWechatClient) Exchange(ctx context.Context, code string) (WechatIdentity, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return WechatIdentity{}, errors.New("login code is required")
	}
	query := url.Values{"appid": {c.appID}, "secret": {c.appSecret}, "js_code": {code}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return WechatIdentity{}, fmt.Errorf("create WeChat request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return WechatIdentity{}, fmt.Errorf("exchange WeChat code: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return WechatIdentity{}, fmt.Errorf("WeChat returned HTTP %d", resp.StatusCode)
	}
	var body struct {
		OpenID  string `json:"openid"`
		UnionID string `json:"unionid"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, 64<<10))
	if err := dec.Decode(&body); err != nil {
		return WechatIdentity{}, fmt.Errorf("decode WeChat response: %w", err)
	}
	if body.ErrCode != 0 {
		return WechatIdentity{}, fmt.Errorf("WeChat rejected login (%d)", body.ErrCode)
	}
	if body.OpenID == "" {
		return WechatIdentity{}, errors.New("WeChat response omitted openid")
	}
	return WechatIdentity{OpenID: body.OpenID, UnionID: body.UnionID}, nil
}

type DevelopmentWechatClient struct{}

func (DevelopmentWechatClient) Exchange(_ context.Context, code string) (WechatIdentity, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return WechatIdentity{}, errors.New("login code is required")
	}
	return WechatIdentity{OpenID: "development:" + code}, nil
}
