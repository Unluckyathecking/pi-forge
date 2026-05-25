## 2024-05-24 - Pre-computing dependency maps in Orchestrator graph
**Learning:** Calling `graph.edges.filter` inside a task loop causes an O(V * E) iteration when traversing task dependencies, which could block performance significantly for larger graphs.
**Action:** When filtering or looking up dependencies in graph edges, always prefer pre-computing them into an O(E) map to bring down lookup complexity to O(V + E).

## 2024-05-18 - [Optimizing reverse search in arrays]
**Learning:** Using `[...arr].reverse().find(...)` to find the last occurrence of an element in an array is an anti-pattern that creates unnecessary shallow copies and temporary arrays. This leads to $O(N)$ space complexity and increased garbage collection overhead, particularly harmful for arrays that grow over time (like ledgers).
**Action:** Always use a reverse `for` loop (e.g. `for (let i = arr.length - 1; i >= 0; i--)`) to find elements from the end of an array when performance and memory footprint matter. This reduces space complexity to $O(1)$.
