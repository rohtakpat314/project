#include <vector>
#include <utility>
#include <iostream>

struct Graph {
    int n; 
    std::vector<int> spin; 
    std::vector<std::vector<std::pair<int, int>>> adj; 
};

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
 * Energy change from flipping spin at a vertex.
 * Each edge adds weight * the neighbor's spin. 
 * A negative return implies that the flip would lower the energy and 
 * raise the cut, so the flip is kept. This is the downhill flip. 
 * A positive return raises the energy/decreases the cut. That uphill flip
 * can still be accepted while the temperature is high.
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

// create n vertices, each with spin +1, no edges (cut = 0)

Graph make_graph(int n) {
    Graph graph;
    graph.n = n; 
    graph.spin.assign(n, +1);
    graph.adj.assign(n, {});
    return graph;
}

// a belongs to b, and vice versa (neighboring vertices)
void add_edge(Graph &graph, int a, int b, int weight) {
    graph.adj[a].push_back({b, weight});
    graph.adj[b].push_back({a, weight});
}