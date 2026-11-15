struct Graph {
    int n; 
    std::vector<int> spin; 
    std::vector<std::vector<std::pair<int, int>>> adj; 
}

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

/*
 * Energy change from flipping the spin at vertex i.
 * Each edge adds weight * the neighbor's spin. The return multiplies
 * that sum by -spin[i]. A negative return lowers the energy and raises
 * the cut, so the flip is kept. Zero leaves the cut unchanged and is kept.
 * A positive return raises the energy. That uphill flip can still be
 * accepted while the temperature is high.
 */

int change_energy (const Graph& graph, int i) { 
    int field = 0; 

    for (const auto& edge : graph.adj[i]) {
        int v = edge.first; 
        int w = edge.second; 
        field += w * graph.spin[v];
    }

    return -graph.spin[i] * field;
}