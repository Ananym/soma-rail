# Soma Rail: notes for Claude

## Subagents

- Dispatch delegated work to Sonnet or Opus subagents: pass `model: "sonnet"` or `model: "opus"` on
  every Agent call. Never start a Fable subagent (that includes `subagent_type: "fork"`, which
  always runs on the session's own model) unless the owner explicitly asks for one.
