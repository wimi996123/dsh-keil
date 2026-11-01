## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `npm run check` and `npm test` pass (14/14 today)
- [ ] No machine-specific paths committed (UV4/Keil/checkout paths belong in `~/.dsh/keil/config.json` or the environment)
- [ ] If a command, flag or tool action changed: README.md, README.zh-CN.md and AGENTS.md are updated
- [ ] Registration edits stay byte-preserving (add-then-remove restores the uvprojx byte for byte)
- [ ] Disk source files and `.uvoptx` are still untouched; backups still happen before every write
- [ ] The agent still never auto-selects a project
