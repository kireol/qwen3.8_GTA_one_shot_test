# Context Management Rules

You must maintain project continuity across context compaction
and separate sessions.

## Project State

Maintain docs/agent/PROJECT_STATE.md.

Update it whenever:
- An architectural decision is made.
- A significant implementation is completed.
- A task is started or completed.
- A bug or blocker is discovered.
- Requirements change.

## Before Context Compaction

Before compaction, ensure PROJECT_STATE.md contains:

1. Current objective.
2. Important architectural decisions.
3. Completed work.
4. Current work in progress.
5. Outstanding tasks.
6. Known issues and blockers.
7. Important files and their purposes.

Preserve unfinished work. Never mark a task complete
without verification.

## After Context Compaction

Immediately reread PROJECT_STATE.md.

Re-establish:
- Current objective.
- Outstanding tasks.
- Last completed milestone.
- Next action.

Do not repeat completed work unless verification
shows it is necessary.

## Session Startup

At the beginning of every new session:
1. Read PROJECT_STATE.md.
2. Inspect git status.
3. Review recent commits.
4. Identify unfinished work.
5. Continue from the last verified state.

## Memory

Save durable architectural decisions and project-specific
knowledge to Qwen's persistent memory.

Do not save temporary debugging output or transient details.


## Long-Running Command Management

Use background execution (`is_background: true`) for commands
expected to take more than 30 seconds whenever the execution
tool supports it.

### Commands that should generally run in the background

- Build watchers
- Development servers
- Application servers
- Smoke tests
- Integration tests
- Long-running test suites
- Benchmarking and performance tests
- Polling loops
- Database imports and large data processing jobs
- Long-running compilation tasks
- llama.cpp model benchmarks
- Model load and inference stress tests
- Context-length and prompt-processing benchmarks
- Tokens-per-second comparisons
- GPU and memory stress tests
- Autonomous software engineering benchmarks
- Multi-model coding comparisons
- OpenCode and Qwen Code agent evaluations

### Execution Rules

1. Do not block the interactive session waiting for long-running
   processes when background execution is supported.
2. Use foreground execution for short commands that should
   return immediately.
3. After starting a background process, inspect its status
   and output using `/tasks`.
4. Wait for completion when the task result is required before
   proceeding.
5. Inspect errors, exit codes, and output before declaring success.
6. Never restart a stateful operation simply because its
   foreground execution timed out or returned a warning.
7. For deployments, migrations, git pushes, and other operations
   with potential side effects, verify the original operation's
   status before attempting another run.

### Benchmarking Rules

For llama.cpp and local AI benchmarks:

1. Run lengthy benchmarks in the background.
2. Capture complete stdout and stderr.
3. Record model name, quantization, context size, GPU layers,
   KV cache settings, and relevant launch arguments.
4. Record prompt processing tokens/sec separately from
   generation tokens/sec.
5. Record peak VRAM and system RAM usage when available.
6. Do not terminate a benchmark before collecting its results.
7. Compare models using identical prompts and test conditions.
8. Wait for benchmark completion before drawing conclusions.

### Software Engineering Benchmark Rules

For autonomous coding agent evaluations:

1. Run long-running test suites and agent evaluations
   in the background.
2. Preserve logs and test artifacts.
3. Track execution time, token usage, and completion status.
4. Do not start duplicate evaluations while an existing
   evaluation is still running.
5. Collect final test results before scoring an evaluation.
6. Preserve failures and debugging information for later analysis.

### Important

The `is_background: true` parameter is a tool execution
parameter, not a shell command argument.

Only use it when the available execution tool supports it.
Background execution does not mean fire-and-forget.
Always inspect results when they are needed for subsequent work.

