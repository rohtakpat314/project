int cut (const Graph& graph) {
    int total = 0; 

    for (int i = 0; i < g.n; i++) {
        for (const auto& edge : g.adj[u]) {
            int v = edge.first; // represents the vertex adjacent to u
            int w = edge.second; // represents the weight of the edge btwn u and v
            if (v < u) {
                continue; 
            }
            int product = g.spin[u] * g.spin[v]; 
            total += w * (1 - product) / 2; 
        }
    }
    return total; 
}