import Linkable from '#/datastruct/Linkable.js';
import { SIM_FAST_ITER as SIM_FAST } from '#/simfast.js';   // rs-sdk OFFLINE SIM perf

// rs-sdk OFFLINE SIM perf (SIM_FAST): LinkList.all()'s generator as a class iterator with the same steps
class LinkListIter<T> {
    private started = false;
    private finished = false;
    private save: Linkable | null = null;
    constructor(private readonly list: LinkList<Linkable>, private readonly reverse: boolean) {}
    next(): IteratorResult<T> {
        if (this.finished) return { done: true, value: undefined };
        const list = this.list;
        let link: Linkable | null;
        if (!this.started) { this.started = true; link = this.reverse ? list.tail() : list.head(); }
        else { list.cursor = this.save; link = this.reverse ? list.prev() : list.next(); }
        if (link === null) { this.finished = true; return { done: true, value: undefined }; }
        this.save = list.cursor;
        return { done: false, value: link as unknown as T };
    }
    [Symbol.iterator](): this { return this; }
}

export default class LinkList<T extends Linkable> {
    private readonly sentinel: Linkable = new Linkable();
    public cursor: Linkable | null = null;

    constructor() {
        this.sentinel.next = this.sentinel;
        this.sentinel.prev = this.sentinel;
    }

    // push
    addTail(node: T): void {
        if (node.prev) {
            node.unlink();
        }
        node.prev = this.sentinel.prev;
        node.next = this.sentinel;
        if (node.prev) {
            node.prev.next = node;
        }
        node.next.prev = node;
    }

    addHead(node: T): void {
        if (node.prev) {
            node.unlink();
        }
        node.prev = this.sentinel;
        node.next = this.sentinel.next;
        node.prev.next = node;
        if (node.next) {
            node.next.prev = node;
        }
    }

    // pop
    removeHead(): T | null {
        const node: T | null = this.sentinel.next as T | null;
        if (node === this.sentinel) {
            return null;
        }
        node?.unlink();
        return node;
    }

    head(): T | null {
        const node: T | null = this.sentinel.next as T | null;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        this.cursor = node?.next || null;
        return node;
    }

    tail(): T | null {
        const node: T | null = this.sentinel.prev as T | null;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        this.cursor = node?.prev || null;
        return node;
    }

    next(): T | null {
        const node: T | null = this.cursor as T | null;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        this.cursor = node?.next || null;
        return node;
    }

    prev(): T | null {
        const node: T | null = this.cursor as T | null;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }
        this.cursor = node?.prev || null;
        return node;
    }

    clear(): void {
        while (true) {
            const node: T | null = this.sentinel.next as T | null;
            if (node === this.sentinel) {
                return;
            }
            node?.unlink();
        }
    }

    // rs-sdk OFFLINE SIM perf (SIM_FAST): the generator below as a plain iterator object with the same steps: head()/tail()
    // on the first next(), then restore the saved cursor and step with next()/prev(); same cursor side effects (an empty
    // list still resets the cursor on the first next()). Every npc runs processQueue every tick, mostly on an empty queue.
    all(reverse = false): IterableIterator<T> {
        if (!SIM_FAST) return this.allGen(reverse);
        return new LinkListIter<T>(this as unknown as LinkList<Linkable>, reverse) as unknown as IterableIterator<T>;
    }

    private *allGen(reverse = false): IterableIterator<T> {
        if (reverse) {
            for (let link = this.tail(); link !== null; link = this.prev()) {
                const save = this.cursor;
                yield link;
                this.cursor = save;
            }
        } else {
            for (let link = this.head(); link !== null; link = this.next()) {
                const save = this.cursor;
                yield link;
                this.cursor = save;
            }
        }
    }
}
