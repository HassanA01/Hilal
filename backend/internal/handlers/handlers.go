package handlers

import (
	"log/slog"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/HassanA01/Hilal/backend/internal/config"
	"github.com/HassanA01/Hilal/backend/internal/game"
	"github.com/HassanA01/Hilal/backend/internal/hub"
)

type Handler struct {
	db              *pgxpool.Pool
	redis           *redis.Client
	hub             *hub.Hub
	engine          *game.Engine
	config          *config.Config
	anthropicClient *anthropic.Client
	uploadsDir      string
}

func New(db *pgxpool.Pool, redisClient *redis.Client, gameHub *hub.Hub, cfg *config.Config) *Handler {
	var ac *anthropic.Client
	if cfg.AnthropicAPIKey != "" {
		c := anthropic.NewClient(option.WithAPIKey(cfg.AnthropicAPIKey))
		ac = &c
	}

	uploadsDir := cfg.UploadsDir
	if uploadsDir == "" {
		uploadsDir = "./uploads"
	}
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		slog.Error("failed to create uploads directory", "path", uploadsDir, "error", err)
	}

	return &Handler{
		db:              db,
		redis:           redisClient,
		hub:             gameHub,
		engine:          game.NewEngine(gameHub, db, redisClient),
		config:          cfg,
		anthropicClient: ac,
		uploadsDir:      uploadsDir,
	}
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Route("/api/v1", func(r chi.Router) {
		// Auth
		r.Post("/auth/register", h.Register)
		r.Post("/auth/login", h.Login)

		// Quiz management (admin only)
		r.Group(func(r chi.Router) {
			r.Use(h.RequireAuth)
			r.Get("/quizzes", h.ListQuizzes)
			r.Post("/quizzes", h.CreateQuiz)
			r.Post("/quizzes/generate", h.GenerateQuiz)
			r.Post("/quizzes/generate/upload", h.GenerateQuizFromUpload)
			r.Get("/quizzes/{quizID}", h.GetQuiz)
			r.Put("/quizzes/{quizID}", h.UpdateQuiz)
			r.Delete("/quizzes/{quizID}", h.DeleteQuiz)

			// Game session management
			r.Get("/sessions", h.ListSessions)
			r.Post("/sessions", h.CreateSession)
			r.Get("/sessions/{sessionID}", h.GetSession)
			r.Delete("/sessions/{sessionID}", h.EndSession)
			r.Post("/sessions/{sessionID}/start", h.StartSession)

			// Image uploads (admin only)
			r.Post("/uploads/image", h.UploadImage)
		})

		// Uploaded images (public — players need to see them)
		r.Get("/uploads/*", h.ServeUpload)

		// Player-facing (no auth)
		r.Post("/sessions/join", h.JoinSession)
		r.Get("/sessions/code/{code}", h.GetSessionByCode)
		r.Get("/sessions/{sessionID}/players", h.ListSessionPlayers)
		r.Get("/sessions/{sessionID}/players/{playerID}/results", h.GetPlayerResults)

		// WebSocket endpoints
		r.Get("/ws/host/{sessionCode}", h.HostWebSocket)
		r.Get("/ws/player/{sessionCode}", h.PlayerWebSocket)
	})
}
