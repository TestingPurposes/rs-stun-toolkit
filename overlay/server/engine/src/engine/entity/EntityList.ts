import Entity from '#/engine/entity/Entity.js';
import Npc from '#/engine/entity/Npc.js';
import { SIM_FAST_ITER as SIM_FAST } from '#/simfast.js';   // rs-sdk OFFLINE SIM perf

// rs-sdk OFFLINE SIM perf (SIM_FAST): EntityList's walk as a class iterator (one allocation, no generator resume)
class EntityListIter<T> {
    private i = 0;
    constructor(private readonly ids: Int32Array, private readonly list: Array<T | undefined>) {}
    next(): IteratorResult<T> {
        const ids = this.ids;
        while (this.i < ids.length) {
            const index = ids[this.i++];
            if (index === -1) continue;
            const entity = this.list[index];
            if (typeof entity === 'undefined') continue;
            return { done: false, value: entity };
        }
        this.i = ids.length;
        return { done: true, value: undefined };
    }
    [Symbol.iterator](): this { return this; }
}

// inspired by https://github.com/rsmod/rsmod/blob/master/game/src/main/kotlin/org/rsmod/game/model/mob/list/MobList.kt
abstract class EntityList<T extends Entity> extends Array<T | undefined> {
    // constructor
    private readonly free: Set<number>;
    protected readonly indexPadding: number;
    protected readonly ids: Int32Array;

    // runtime
    protected lastUsedIndex: number = 0;

    protected constructor(size: number, indexPadding: number) {
        super(size);
        this.ids = new Int32Array(size).fill(-1);
        this.free = new Set<number>(Array.from({ length: size }, (_, index) => index));
        this.indexPadding = indexPadding;
    }

    next(_: boolean = false, start: number = this.lastUsedIndex + 1): number {
        const length: number = this.ids.length;
        for (let index: number = start; index < length; index++) {
            if (this.ids[index] === -1) {
                return index;
            }
        }
        for (let index: number = this.indexPadding; index < start; index++) {
            if (this.ids[index] === -1) {
                return index;
            }
        }
        throw new Error('[EntityList] no space for new entities');
    }

    // rs-sdk OFFLINE SIM perf (SIM_FAST): the same walk as the generator below (ids read lazily one at a time, so adds and
    // removes during the loop are seen exactly as before) as a plain iterator object: no generator resume, no typed-array
    // iterator per tick (~12% of the sim engine's tick in the profile: every npc loop runs over all 16384 ids)
    [Symbol.iterator](): ArrayIterator<T> {
        if (!SIM_FAST) return this.iterGen();
        return new EntityListIter<T>(this.ids, this as unknown as Array<T | undefined>) as unknown as ArrayIterator<T>;
    }

    private *iterGen(): ArrayIterator<T> {
        for (const index of this.ids) {
            if (index === -1) {
                continue;
            }
            const entity: T | undefined = this[index];
            if (typeof entity === 'undefined') {
                continue;
            }
            yield entity;
        }
    }

    get count(): number {
        return Math.max(this.length - this.free.size, 0);
    }

    get(id: number): T | undefined {
        if (id < 0 || id >= this.ids.length) {
            return;
        }

        const index: number = this.ids[id];
        return index !== -1 ? this[index] : undefined;
    }

    set(id: number, entity: T): void {
        if (id < 0 || id >= this.ids.length || this.ids[id] !== -1) {
            throw new Error(`[EntityList] invalid or occupied id ${id}`);
        }

        if (!this.free.size) {
            throw new Error('[EntityList] cannot find available entities slot.');
        }

        const index = this.free.values().next().value!;
        this.free.delete(index);
        this.ids[id] = index;
        this[index] = entity;
        this.lastUsedIndex = id;
    }

    remove(id: number): void {
        if (id < 0 || id >= this.ids.length) {
            return;
        }

        const index: number = this.ids[id];
        if (index !== -1) {
            this.ids[id] = -1;
            this.free.add(index);
            delete this[index];
        }
    }

    reset(): void {
        this.length = 0;
        this.ids.fill(-1);
        this.free.clear();
        for (let i: number = 0; i < this.ids.length; i++) {
            this.free.add(i);
        }
    }
}

export class NpcList extends EntityList<Npc> {
    constructor(size: number) {
        super(size, 0);
    }
}
