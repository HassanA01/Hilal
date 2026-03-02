package config

import (
	"log"
	"os"
)

type Config struct {
	Port            string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	FrontendURL     string
	AnthropicAPIKey string
}

func Load() *Config {
	secret := getEnv("JWT_SECRET", "")
	if secret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}

	anthropicKey := getEnv("ANTHROPIC_API_KEY", "")
	if anthropicKey == "" {
		log.Println("ANTHROPIC_API_KEY not set — AI quiz generation disabled")
	}

	return &Config{
		Port:            getEnv("PORT", "8081"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://iftaroot:iftaroot@localhost:5432/iftaroot?sslmode=disable"),
		RedisURL:        getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:       secret,
		FrontendURL:     getEnv("FRONTEND_URL", "http://localhost:5173"),
		AnthropicAPIKey: anthropicKey,
	}
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
