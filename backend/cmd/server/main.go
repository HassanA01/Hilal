package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"github.com/HassanA01/Hilal/backend/internal/config"
	"github.com/HassanA01/Hilal/backend/internal/db"
	"github.com/HassanA01/Hilal/backend/internal/handlers"
	"github.com/HassanA01/Hilal/backend/internal/metrics"
	mw "github.com/HassanA01/Hilal/backend/internal/middleware"

	"github.com/HassanA01/Hilal/backend/internal/hub"
)

func main() {
	// Set up structured JSON logging.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	_ = godotenv.Load()

	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := db.Migrate(cfg.DatabaseURL); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	redisClient, err := db.ConnectRedis(cfg.RedisURL)
	if err != nil {
		slog.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	gameHub := hub.New(redisClient)
	go gameHub.Run()

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(mw.RequestID) // correlation ID propagation
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.FrontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	h := handlers.New(database, redisClient, gameHub, cfg)
	h.RegisterRoutes(r)

	r.Get("/health", healthHandler(database, redisClient, cfg))
	r.Get("/metrics", metrics.Handler())

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // disabled: WebSocket connections manage their own write deadlines
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("server listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down server")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}

// healthHandler returns a handler that pings DB, Redis, and reports AI availability.
func healthHandler(database *pgxpool.Pool, redisClient *redis.Client, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		status := http.StatusOK
		result := map[string]any{
			"status": "ok",
		}

		components := map[string]string{}

		// DB
		if err := database.Ping(ctx); err != nil {
			components["database"] = "unhealthy: " + err.Error()
			status = http.StatusServiceUnavailable
		} else {
			components["database"] = "healthy"
		}

		// Redis
		if err := redisClient.Ping(ctx).Err(); err != nil {
			components["redis"] = "unhealthy: " + err.Error()
			status = http.StatusServiceUnavailable
		} else {
			components["redis"] = "healthy"
		}

		// AI
		if cfg.AnthropicAPIKey != "" {
			components["ai"] = "configured"
		} else {
			components["ai"] = "disabled"
		}

		result["components"] = components
		if status != http.StatusOK {
			result["status"] = "degraded"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(result)
	}
}
