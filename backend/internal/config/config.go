package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type Config struct {
	Port               string
	DatabaseURL        string
	RedisURL           string
	JWTSecret          string
	FrontendURL        string
	AnthropicAPIKey    string
	AIRateLimitPerHour int
	MaxAIQuestions     int
	UploadsDir         string
	SuperadminEmail    string
}

func Load() *Config {
	anthropicKey := getEnv("ANTHROPIC_API_KEY", "")
	if anthropicKey == "" {
		slog.Warn("ANTHROPIC_API_KEY not set — AI quiz generation disabled")
	}

	aiRateLimit := 5
	if v := os.Getenv("AI_RATE_LIMIT_PER_HOUR"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			aiRateLimit = n
		}
	}

	maxAIQuestions := 20
	if v := os.Getenv("MAX_AI_QUESTIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxAIQuestions = n
		}
	}

	return &Config{
		Port:               getEnv("PORT", "8081"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://hilal:hilal@localhost:5432/hilal?sslmode=disable"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		FrontendURL:        getEnv("FRONTEND_URL", "http://localhost:5173"),
		AnthropicAPIKey:    anthropicKey,
		AIRateLimitPerHour: aiRateLimit,
		MaxAIQuestions:     maxAIQuestions,
		UploadsDir:         getEnv("UPLOADS_DIR", "./uploads"),
		SuperadminEmail:    getEnv("SUPERADMIN_EMAIL", ""),
	}
}

// Validate checks that all required env vars are present and well-formed.
// Call this before attempting any DB/Redis connections.
func (c *Config) Validate() error {
	required := map[string]string{
		"DATABASE_URL": c.DatabaseURL,
		"REDIS_URL":    c.RedisURL,
		"JWT_SECRET":   c.JWTSecret,
		"PORT":         c.Port,
		"FRONTEND_URL": c.FrontendURL,
	}
	for name, val := range required {
		if strings.TrimSpace(val) == "" {
			return fmt.Errorf("%s is required and must not be empty", name)
		}
	}

	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		return fmt.Errorf("DATABASE_URL must start with postgres:// or postgresql://")
	}

	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return fmt.Errorf("REDIS_URL must start with redis:// or rediss://")
	}
	if containsControlChars(c.RedisURL) {
		return fmt.Errorf("REDIS_URL contains control characters (newlines, tabs, etc.) — check for line-wrapping in your config")
	}

	return nil
}

// containsControlChars returns true if s contains any ASCII control character.
func containsControlChars(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
