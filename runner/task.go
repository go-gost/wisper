package runner

import (
	"context"
)

// TaskID identifies a background task.
type TaskID string

const (
	// TaskUpdateStats is the periodic stats polling task.
	TaskUpdateStats TaskID = "service.stats.update"
)

// Task is the interface for background tasks.
type Task interface {
	ID() TaskID
	Run(ctx context.Context) error
}
