package db

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func Migrate(databaseURL string) error {
	// Convert postgres:// or postgresql:// to pgx5:// for the migrate driver.
	// Fly Postgres uses postgresql:// scheme; local dev uses postgres://.
	var pgx5URL string
	switch {
	case strings.HasPrefix(databaseURL, "postgresql://"):
		pgx5URL = "pgx5://" + databaseURL[len("postgresql://"):]
	case strings.HasPrefix(databaseURL, "postgres://"):
		pgx5URL = "pgx5://" + databaseURL[len("postgres://"):]
	default:
		return fmt.Errorf("unsupported DATABASE_URL scheme (expected postgres:// or postgresql://)")
	}

	m, err := migrate.New("file://migrations", pgx5URL)
	if err != nil {
		return fmt.Errorf("failed to create migrator: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("failed to apply migrations: %w", err)
	}
	slog.Info("migrations applied successfully")
	return nil
}
