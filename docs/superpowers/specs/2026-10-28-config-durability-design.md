# Config durability: atomic replace, backup, and slower stats persistence

Date: 2026-10-28
Status: draft (awaiting approval)

## Intent

On 2026-10-28 an unclean power-off left `wisper.yaml` empty. The next start
loaded an empty config, and the 1 Hz stats save overwrote the only copy within a
second, so the tunnels and entrypoints were unrecoverable.

Make a crash at any point unable to publish an empty or partial config, keep the
last good copy, preserve an unreadable file for diagnosis, and stop rewriting the
whole file every second.

## Goals

- A crash/kill at any moment leaves either the previous config or the new one,
  never a zero-length or half-written file.
- The previous good config survives one bad write or bad load (`.bak`).
- An unreadable file is preserved as `wisper.yaml.corrupt-<ts>` instead of being
  silently replaced.
- Startup recovers from `.bak` when the main file is missing or unreadable.
- Stats/event persistence runs at most every 10s. Structural changes (create,
  edit, delete, settings, graceful stop) still persist immediately.
- Unit tests cover the failure and fallback paths.

## Non-goals

- No config schema, API, or UI change.
- No separate stats file (considered; larger, and not needed for this failure).
- No change to the live stats/API path; only how often it reaches disk.

## Approaches considered

1. **Atomic write + backup + corrupt preservation + 10s stats save** (chosen).
2. Atomic write only, keep the 1s save: smallest diff, but leaves two full-file
   rewrites per second of flash wear and keeps a large exposure for future bugs.
3. Move stats to their own file: cleanest long-term, but adds a second store,
   migration and read paths; out of proportion for this fix.

## Design

### Atomic write (`config.Write`)

- Encode YAML into a buffer as today.
- `os.CreateTemp(dir, ".wisper.yaml-*")`; set the mode to the current file's mode
  when it exists, else `0644`; write the buffer; `f.Sync()`; `f.Close()`.
- Publish: if the current file exists, `os.Rename(current, current+".bak")`, then
  `os.Rename(tmp, current)`. If the process dies between the two renames, the
  next load finds no main file and restores `.bak`.
- Best-effort `Sync` on the directory after the rename; ignore errors from
  filesystems/platforms that cannot sync a directory.
- Any error before publishing removes the temp file and leaves the current file
  untouched. `writeMu` still serializes writers. The signature is unchanged.

### Load (`config.load` / `config.Init`)

- Read the file first, then decode: an open/read failure (permissions, I/O, a
  directory) is not corruption. Leave that file alone, report the error and do
  not replace it with an older backup.
- A decode failure (empty file or malformed YAML) is corruption:
  - move it to an unused `wisper.yaml.corrupt-<UTC ts>` name (a numeric suffix
    on collision), keeping it for diagnosis;
  - try `wisper.yaml.bak`; if it decodes, use it and rewrite the main file
    atomically so it becomes valid again;
  - otherwise start from an empty config and write the defaults.
- A missing main file with a valid `.bak` also recovers from `.bak`.
- Recovery writes do not rotate the main file into `.bak`: the main is either
  missing or the corrupt file that could not be moved, and the good backup must
  survive.
- Keep the load error and report it through the configured logger after
  `initLog()`, so it lands in `wisper.log` instead of stdout (Android has no
  readable stdout). This is the message that was missing during the incident.
- When the main file is gone, the restored file keeps the backup's permission
  bits rather than falling back to `0644`.

### Stats/event persistence

- The stats task still runs every `stats_interval` (default 1s) to compute rates
  and liveness.
- `updateTunnel` and `updateEntrypoint` stop calling `SaveConfig`; `Run` tracks
  the last save and calls `tunnel.SaveConfig` + `entrypoint.SaveConfig` when
  10s have elapsed.
- API handlers and `Stop()` keep calling `SaveConfig` immediately, so user
  changes are never delayed.
- An event recorded by `observeTransitions` reaches disk with the next periodic
  save (at most 10s later).

### Tests

- `config`: round trip; `.bak` holds the previous payload; temp file removed on
  success and on failure; load falls back to `.bak` when main is empty, corrupt,
  or missing; corrupt main is renamed; empty main with no `.bak` writes defaults;
  a failed publish leaves the old main intact (failure injected through a
  package-level `renameFile` seam, like `identityRename`).
- `runner/task`: with a 1s interval, ticks inside 10s produce one save and a tick
  after the window produces the next; structural saves are unaffected.
