## 2024-05-24 - Pre-computing dependency maps in Orchestrator graph
**Learning:** Calling `graph.edges.filter` inside a task loop causes an O(V * E) iteration when traversing task dependencies, which could block performance significantly for larger graphs.
**Action:** When filtering or looking up dependencies in graph edges, always prefer pre-computing them into an O(E) map to bring down lookup complexity to O(V + E).
