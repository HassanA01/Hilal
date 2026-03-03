package handlers

import (
	"net/http"

	appMiddleware "github.com/HassanA01/Hilal/backend/internal/middleware"
)

func (h *Handler) RequireAuth(next http.Handler) http.Handler {
	return appMiddleware.RequireAuth(h.config.JWTSecret)(next)
}
