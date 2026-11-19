#include <iostream>
#include <utility>
#include <vector>
#include <cmath>
#include <cstdint>

struct Graph {
    int n;
    std::vector<int> spin;
    std::vector<std::vector<std::pair<int, int>>> adj;
};

int cut(const Graph& graph) {
    int total = 0;

    for (int i = 0; i < graph.n; i++) {
        for (const auto& edge : graph.adj[i]) {
            int v = edge.first;
            int w = edge.second;
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

int change_energy(const Graph& graph, int i) {
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

void print_spins(const Graph& graph) {
    for (int s : graph.spin) {
        std::cout << " " << s;
    }
}

uint32_t draw_state = 1; // start at 1, stay in mem between calls 

double unit_draw() {
    draw_state ^= draw_state << 13; // copy LS 13, write back a 1 wherever the copy and original differ
    draw_state ^= draw_state >> 17; // RS 17, write back a 1 wherever the copy and original differ
    draw_state ^= draw_state << 5; // LS 5, write back a 1 wherever the copy and original differ
    return (draw_state & 0xffffff) / 16777216.0;
}

int hottest(const Graph& graph) { // find the max weight of any edge
    int scale = 1;
    for (int i = 0; i < graph.n; i++) {
        for (const auto& edge : graph.adj[i]) {
            int w = edge.second;
            if (w < 0) {
                w = -w;
            }
            if (w > scale) {
                scale = w;
            }
        }
    }
    return scale;
}

// Repeat a pass over every vertex until one pass flips nothing.
// A negative return flips that spin. Zero and positive returns stay.
void sweep(Graph& graph) {
    int best = cut(graph);
    std::vector<int> best_spin = graph.spin;
    double temperature = 3.0 * hottest(graph);
    int pass = 1;

    while (temperature > 0.05) {
        std::cout << "pass " << pass << " temperature " << temperature << "\n";

        for (int i = 0; i < graph.n; i++) {
            int delta = change_energy(graph, i);
            std::cout << "vertex " << i << " return " << delta;

            bool keep = false;
            if (delta < 0) {
                keep = true;
            } else if (delta > 0) {
                keep = unit_draw() < std::exp(-delta / temperature);
            }

            if (keep) {
                graph.spin[i] = -graph.spin[i];
                int now = cut(graph);
                if (now > best) {
                    best = now;
                    best_spin = graph.spin;
                }
                std::cout << " flip";
            }

            std::cout << " spins";
            print_spins(graph);
            std::cout << " cut " << cut(graph) << "\n";
        }

        temperature *= 0.96;
        pass += 1;
    }

    graph.spin = best_spin;
    std::cout << "stop spins";
    print_spins(graph);
    std::cout << " cut " << cut(graph) << "\n";
}

int main() {
    Graph graph = make_graph(3);
    add_edge(graph, 0, 1, -5);
    add_edge(graph, 1, 2, 10);
    std::cout << "path\n";
    sweep(graph);

    Graph example = make_graph(7);
    add_edge(example, 0, 1, -2);
    add_edge(example, 0, 2, 2);
    add_edge(example, 1, 3, 7);
    add_edge(example, 2, 3, 8);
    add_edge(example, 2, 4, 1);
    add_edge(example, 2, 6, -1);
    add_edge(example, 3, 4, -1);
    add_edge(example, 3, 5, 2);
    std::cout << "example\n";
    sweep(example);

    Graph trap = make_graph(4);
    add_edge(trap, 0, 1, 3);
    add_edge(trap, 2, 3, 3);
    add_edge(trap, 0, 2, 2);
    add_edge(trap, 0, 3, 2);
    add_edge(trap, 1, 2, 2);
    add_edge(trap, 1, 3, 2);
    std::cout << "trap\n";
    sweep(trap);
}
