// mm-puzzle.ts — Monkey Madness hangar reinitialisation: 5x5 sliding puzzle (24 tiles, slot 24 empty when solved).
// board[s] = tile number 1..24 at slot s (row*5+col), 0 = hole. Returns the slots to click, in order (each click moves
// the clicked tile into the adjacent hole). Weighted A* (Manhattan + linear conflict): the server's shuffle is a 255-step
// random walk of the hole, shallow enough that this finishes in milliseconds with near-optimal length.
export function solvePuzzle(board: number[], weight = 4, maxNodes = 3_000_000): number[] | null {
    const N = 5;
    const goalPos = (t: number) => t - 1;   // tile t belongs in slot t-1
    const h = (b: Uint8Array): number => {
        let d = 0;
        for (let s = 0; s < 25; s++) { const t = b[s]!; if (!t) continue; const g = goalPos(t); d += Math.abs((s % N) - (g % N)) + Math.abs(((s / N) | 0) - ((g / N) | 0)); }
        // linear conflict: rows
        for (let r = 0; r < N; r++) for (let a = 0; a < N; a++) {
            const ta = b[r * N + a]!; if (!ta || ((goalPos(ta) / N) | 0) !== r) continue;
            for (let c = a + 1; c < N; c++) { const tc = b[r * N + c]!; if (tc && ((goalPos(tc) / N) | 0) === r && goalPos(tc) < goalPos(ta)) d += 2; }
        }
        for (let c = 0; c < N; c++) for (let a = 0; a < N; a++) {
            const ta = b[a * N + c]!; if (!ta || goalPos(ta) % N !== c) continue;
            for (let r = a + 1; r < N; r++) { const tr = b[r * N + c]!; if (tr && goalPos(tr) % N === c && goalPos(tr) < goalPos(ta)) d += 2; }
        }
        return d;
    };
    const start = Uint8Array.from(board);
    const key = (b: Uint8Array) => String.fromCharCode(...b);
    // binary heap of [f, g, id]
    type Node = { b: Uint8Array; g: number; hole: number; parent: number; click: number };
    const nodes: Node[] = [];
    const heap: number[] = []; const fOf: number[] = [];
    const push = (id: number, f: number) => { fOf[id] = f; heap.push(id); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (fOf[heap[p]!]! <= f) break; heap[i] = heap[p]!; i = p; } heap[i] = id; };
    const pop = (): number => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { let i = 0; const f = fOf[last]!; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && fOf[heap[c + 1]!]! < fOf[heap[c]!]!) c++; if (fOf[heap[c]!]! >= f) break; heap[i] = heap[c]!; i = c; } heap[i] = last; } return top; };
    const seen = new Map<string, number>();
    nodes.push({ b: start, g: 0, hole: start.indexOf(0), parent: -1, click: -1 });
    seen.set(key(start), 0); push(0, weight * h(start));
    while (heap.length) {
        const id = pop(); const n = nodes[id]!;
        const hv = h(n.b);
        if (hv === 0 && n.hole === 24) {
            const out: number[] = []; let c = id; while (nodes[c]!.parent >= 0) { out.push(nodes[c]!.click); c = nodes[c]!.parent; }
            return out.reverse();
        }
        if (nodes.length > maxNodes) return null;
        const hole = n.hole, hx = hole % N, hz = (hole / N) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const x = hx + dx, z = hz + dz; if (x < 0 || x >= N || z < 0 || z >= N) continue;
            const s = z * N + x;   // tile at s slides into the hole
            const b = n.b.slice(); b[hole] = b[s]!; b[s] = 0;
            const k = key(b); const g = n.g + 1;
            const prev = seen.get(k); if (prev !== undefined && nodes[prev]!.g <= g) continue;
            const nid = nodes.length; nodes.push({ b, g, hole: s, parent: id, click: s }); seen.set(k, nid);
            push(nid, g + weight * h(b));
        }
    }
    return null;
}

/** Simulate the server's shuffle (random walk of the hole from slot 24) for offline tests. */
export function shuffled(steps = 255, rnd = Math.random): number[] {
    const b = Array.from({ length: 25 }, (_, i) => (i < 24 ? i + 1 : 0));
    let hole = 24;
    for (let k = 0; k < steps; k++) {
        const nb: number[] = []; const x = hole % 5, z = (hole / 5) | 0;
        if (x > 0) nb.push(hole - 1); if (x < 4) nb.push(hole + 1); if (z > 0) nb.push(hole - 5); if (z < 4) nb.push(hole + 5);
        const s = nb[Math.floor(rnd() * nb.length)]!; b[hole] = b[s]!; b[s] = 0; hole = s;
    }
    return b;
}

if (import.meta.main) {
    let worst = 0, total = 0, ms = 0;
    for (let i = 0; i < 50; i++) {
        const b = shuffled(); const t0 = performance.now(); const sol = solvePuzzle(b); ms = Math.max(ms, performance.now() - t0);
        if (!sol) { console.log('FAILED', b.join(',')); continue; }
        // verify
        const c = b.slice(); for (const s of sol) { const hole = c.indexOf(0); c[hole] = c[s]!; c[s] = 0; }
        if (!c.every((v, i) => v === (i < 24 ? i + 1 : 0))) console.log('WRONG');
        worst = Math.max(worst, sol.length); total += sol.length;
    }
    console.log(`50 boards: avg ${(total / 50).toFixed(0)} moves, worst ${worst}, slowest ${ms.toFixed(0)} ms`);
}
