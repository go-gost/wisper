package config

import (
	"context"
	"log/slog"
	"strings"

	"github.com/go-gost/core/logger"
)

// setDefaultSlog points the standard library's logger at the same pipeline as
// gost's logger (see initLog), so the whole process logs through one
// configuration and into one file: wisper's own slog calls, the embedded p2p
// library (which logs with slog), and gost's internals, which take a
// core/logger.Logger.
func setDefaultSlog(log logger.Logger) {
	if log == nil {
		return
	}
	slog.SetDefault(slog.New(gostLogHandler{log: log}))
}

// gostLogHandler forwards slog records to a gost logger, one line each with the
// record's own level. Attributes are appended as key=value, so a line reads the
// way the library that wrote it would print it.
type gostLogHandler struct {
	log   logger.Logger
	attrs []slog.Attr
}

// Enabled defers to the sink's level, which is where the configuration lives.
func (h gostLogHandler) Enabled(_ context.Context, l slog.Level) bool {
	return h.log.IsLevelEnabled(slogToGostLevel(l))
}

func (h gostLogHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Message)
	for _, a := range h.attrs {
		appendSlogAttr(&b, a)
	}
	r.Attrs(func(a slog.Attr) bool {
		appendSlogAttr(&b, a)
		return true
	})
	line := b.String()

	switch {
	case r.Level >= slog.LevelError:
		h.log.Error(line)
	case r.Level >= slog.LevelWarn:
		h.log.Warn(line)
	case r.Level >= slog.LevelInfo:
		h.log.Info(line)
	default:
		h.log.Debug(line)
	}
	return nil
}

func (h gostLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	h.attrs = append(append([]slog.Attr(nil), h.attrs...), attrs...)
	return h
}

// WithGroup drops groups: the bridge is for reading, not for structured
// querying, and flattening keeps every line self-contained.
func (h gostLogHandler) WithGroup(string) slog.Handler { return h }

func appendSlogAttr(b *strings.Builder, a slog.Attr) {
	if a.Equal(slog.Attr{}) {
		return
	}
	b.WriteByte(' ')
	b.WriteString(a.Key)
	b.WriteByte('=')
	b.WriteString(a.Value.String())
}

// slogToGostLevel maps a slog level onto gost's, so the sink can filter.
func slogToGostLevel(l slog.Level) logger.LogLevel {
	switch {
	case l >= slog.LevelError:
		return logger.ErrorLevel
	case l >= slog.LevelWarn:
		return logger.WarnLevel
	case l >= slog.LevelInfo:
		return logger.InfoLevel
	default:
		return logger.DebugLevel
	}
}
