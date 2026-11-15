int cut (const Graph& graph) {
    int total = 0; 

    for (int i = 0; i < graph.n; i++) {
        for (const auto& edge : graph.adj[i]) {
            int v = edge.first; // represents the vertex adjacent to u
            int w = edge.second; // represents the weight of the edge btwn u and v
            if (v < i) {
                continue; 
            }
            int product = graph.spin[i] * graph.spin[v]; 
            total += w * (1 - product) / 2; 
        }
    }
    return total; 
}