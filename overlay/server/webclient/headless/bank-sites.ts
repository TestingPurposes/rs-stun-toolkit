// bank booth stand tiles (stand = where to stand, booth = the booth loc; npc banks give the npc id)
export interface XZ { x: number; z: number }
export interface BankSpec { stand: XZ; booth: XZ; loc: number; npc?: number }
const LOC = { booth: 2213 } as const;

// ---- banks ------------------------------------------------------------------------------------------------------------
const b = (sx: number, sz: number, bx: number, bz: number): BankSpec => ({ stand: { x: sx, z: sz }, booth: { x: bx, z: bz }, loc: LOC.booth });
export const BANKS = {
    alkharid: b(3269, 3168, 3268, 3168),
    seers1: b(2724, 3493, 2724, 3494), seers2: b(2727, 3493, 2727, 3494), seers3: b(2721, 3493, 2721, 3494),
    draynor1: b(3092, 3243, 3091, 3243), draynor2: b(3092, 3242, 3091, 3242), draynor3: b(3092, 3245, 3091, 3245),
    varrockE1: b(3253, 3420, 3253, 3419), varrockE2: b(3254, 3420, 3254, 3419),
    varrockW1: b(3185, 3436, 3186, 3436), varrockW2: b(3185, 3438, 3186, 3438),
    // Edgeville and Falador West
    edgeville: b(3094, 3491, 3095, 3491), faladorW: b(2946, 3368, 2946, 3367),
    catherby: b(2809, 3441, 2809, 3442),
    varrockWNorth: b(3186, 3447, 3186, 3446),
    // a second Falador West stand (one booth east of 2946) and Falador East (the Dwarven Mine bank; booths
    // 3011-3015,3354, stand north of them)
    faladorW2: b(2947, 3368, 2947, 3367), faladorE1: b(3012, 3355, 3012, 3354), faladorE2: b(3013, 3355, 3013, 3354),
    // SHILO VILLAGE: no booth — two `shilobanker` (npc 499) behind the bamboo counter at (2851,2954) /
    // (2853,2955) (m44_46.jm2); banker.rs2 [opnpc3,shilobanker] @openbank. Stand = the walkable tile north of the second banker.
    // Inside the village (wooden gate: Shilo Village quest) — sim/shilo-geo.test.ts.
    shilo: { stand: { x: 2853, z: 2956 }, booth: { x: 2853, z: 2955 }, loc: 0, npc: 499 },
};
