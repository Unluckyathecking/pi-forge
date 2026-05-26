## 2024-05-24 - Pre-computing dependency maps in Orchestrator graph
**Learning:** Calling `graph.edges.filter` inside a task loop causes an O(V * E) iteration when traversing task dependencies, which could block performance significantly for larger graphs.
**Action:** When filtering or looking up dependencies in graph edges, always prefer pre-computing them into an O(E) map to bring down lookup complexity to O(V + E).
## 2024-06-25 - Async I/O Loop Optimization in CLI Commands
**Learning:** In commands like `pi-forge status` that fetch state and artifacts from thousands of directories using the FileSystemAdapter, sequential `for...of` loops reading these files block the event loop linearly, causing significant slowdowns (~1.5s vs ~0.7s locally for 2500 goals).
**Action:** Always replace sequential `for...of` loop I/O with `await Promise.all(array.map(...))` to load files concurrently. Since JavaScript handles state synchronously within the single thread, `Map` updates in these concurrent `Promise.all` mapping functions are perfectly safe.
