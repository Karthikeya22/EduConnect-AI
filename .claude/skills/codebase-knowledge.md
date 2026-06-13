---
name: CodebaseKnowledge
description: Expert codebase navigation using the code-review-graph with automatic incremental updates.
---

# CodebaseKnowledge Skill

Use this skill to deep-dive into the codebase architecture, dependencies, and change impact.

## Protocol

1. **Auto-Update**: ALWAYS start by running `.\code-review-graph update` to ensure the graph reflects recent local changes.
2. **Context First**: Call `get_minimal_context(task="<task>")` or check `.\code-review-graph status` to initialize context.
3. **Graph Tools**: Prioritize these tools over `grep` or `list_dir`:
    - `get_architecture_overview`: High-level community structure.
    - `semantic_search_nodes`: Find logic by natural language.
    - `query_graph`: Trace `callers_of`, `callees_of`, or `imports_of`.
    - `detect_changes`: analyze change impact.
4. **CLI Fallback**: If MCP tools are unavailable in the current session, use:
    - `.\code-review-graph status -v` for core metrics.
    - `.\code-review-graph wiki` to generate/read documentation in `.code-review-graph/wiki/`.
    - `.\code-review-graph visualize` for an interactive map.

## When to Use
- Understanding a new feature or module.
- Tracing the blast radius of a refactor.
- Reviewing PRs or staged changes.
- Finding where a specific logic is implemented.
