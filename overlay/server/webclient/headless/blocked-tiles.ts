// GENERATED FILE - do not edit by hand.
// Regenerate with: bun server/webclient/headless/collision-diff.ts
//
// Tiles/edges inside x 2600..3260, z 3200..3520 (level 0) that the
// SDK offline pathfinder (sdk/pathfinding.ts + sdk/collision-data.json) treats
// as walkable/steppable but the server's true static collision (rebuilt from
// server/content/maps/*.jm2 via the engine's own routefinder) blocks.
//
// Edges at genuinely OPENABLE doors are excluded (bots open those en route).
// An edge is only masked when the door CANNOT be opened by a bot: its "Open" op has no
// oploc handler (neither [oplocN,<debugname>] nor [oplocN,_<category>]), or the flood-fill
// guard found the door is not what separates the two sides. Those are the real fake gaps.
//
// ⛔ HISTORY: this used to be a NAME REGEX /(^open|open$|unopenable)/ over the
// loc debugname. That misread the model-variant suffix in names like
// `inaccastledoubledoorropen` as a door STATE and walled 497 of 513 edges that are ordinary
// openable doors (loc 1530/1519/1516/1536/1512) — sealing the Ardougne bank rooms and
// parking 168 trainees. Openability is now decided by the same handler test that
// sdk/navgrid/extract-scripted-doors.mjs uses. Do not reintroduce a name-based test.
// Generated 2026-10-11T19:57:11.878Z.

/** [x, z] pairs: SDK says walkable, server tile collision says blocked. */
export const BLOCKED_TILES: [number, number][] = [
    [2639, 3415],
    [2650, 3297],
    [2654, 3427],
    [2658, 3438],
    [2667, 3414],
    [2669, 3316],
    [2669, 3442],
    [2682, 3429],
    [3046, 3348],
    [3077, 3415],
    [3092, 3274],
    [3160, 3440],
    [3206, 3385],
];

/**
 * [x, z, dx, dz] directed single steps: SDK canTravel allows the step but the
 * server StepValidator refuses it and no openable door explains the crossing
 * (permanent walls/fences the SDK wrongly thinks passable, incl. scenery-door
 * fake gaps — annotated with the responsible loc).
 */
export const BLOCKED_EDGES: [number, number, number, number][] = [
    [2631, 3382, 1, -1], // loc_1530#1530
    [2639, 3414, 0, 1], // loc_1530#1530
    [2639, 3414, 1, 1], // loc_1530#1530
    [2640, 3416, -1, -1], // loc_1530#1530
    [2643, 3334, 1, -1], // loc_1530#1530
    [2650, 3298, 0, -1], // loc_1530#1530
    [2650, 3298, -1, -1], // loc_1530#1530
    [2654, 3426, 0, 1], // lockeddoor1#1591
    [2654, 3426, 1, 1], // lockeddoor1#1591
    [2657, 3437, 1, 1], // ranging_guild_door#2514
    [2658, 3439, 0, -1], // ranging_guild_door#2514
    [2658, 3439, -1, -1], // ranging_guild_door#2514
    [2658, 3496, -1, 1], // ikov_shinykeydoor#99
    [2667, 3294, -1, -1], // loc_1530#1530
    [2667, 3415, 0, -1], // lockeddoor1#1591
    [2667, 3415, -1, -1], // lockeddoor1#1591
    [2668, 3317, 1, -1], // loc_1530#1530
    [2669, 3441, 0, 1], // lockeddoor1#1591
    [2669, 3441, 1, 1], // lockeddoor1#1591
    [2670, 3316, -1, 0], // loc_1530#1530
    [2670, 3316, -1, 1], // loc_1530#1530
    [2682, 3430, 0, -1], // lockeddoor1#1591
    [2682, 3430, -1, -1], // lockeddoor1#1591
    [2765, 3277, 1, 0], // loc_1533#1533
    [2765, 3287, 1, 0], // loc_1533#1533
    [2766, 3277, -1, 0], // loc_1533#1533
    [2766, 3287, -1, 0], // loc_1533#1533
    [2820, 3356, 0, 1], // loc_1533#1533
    [2820, 3357, 0, -1], // loc_1533#1533
    [2822, 3354, 1, 0], // loc_1533#1533
    [2823, 3354, -1, 0], // loc_1533#1533
    [2848, 3370, 1, 0], // loc_1530#1530
    [2849, 3370, -1, 0], // loc_1530#1530
    [2851, 3341, 0, 1], // loc_1533#1533
    [2851, 3342, 0, -1], // loc_1533#1533
    [2854, 3370, 1, 0], // loc_1553#1553
    [2854, 3370, 1, 1], // loc_1553#1553
    [2854, 3371, 1, 0], // loc_1551#1551
    [2854, 3371, 1, -1], // loc_1551#1551
    [2855, 3370, -1, 0], // loc_1553#1553
    [2855, 3370, -1, 1], // loc_1551#1551
    [2855, 3371, -1, 0], // loc_1551#1551
    [2855, 3371, -1, -1], // loc_1553#1553
    [2883, 3422, 1, 1], // loc_1530#1530
    [2883, 3443, 1, 1], // loc_1530#1530
    [2885, 3443, -1, 1], // loc_1530#1530
    [2887, 3419, -1, 1], // loc_1530#1530
    [2897, 3451, -1, -1], // loc_1530#1530
    [2914, 3434, 0, 1], // loc_1530#1530
    [2914, 3435, 0, -1], // loc_1530#1530
    [2932, 3289, 1, -1], // crafting_guild_door#2647
    [2934, 3289, -1, -1], // crafting_guild_door#2647
    [2935, 3320, -1, -1], // membergatel#1596
    [2981, 3339, 1, 1], // loc_1519#1519
    [3011, 3345, -1, -1], // loc_1530#1530
    [3014, 3210, -1, 1], // loc_1530#1530
    [3046, 3347, 0, 1], // loc_1530#1530
    [3046, 3347, 1, 1], // loc_1530#1530
    [3047, 3349, -1, -1], // loc_1530#1530
    [3076, 3416, 1, -1], // loc_1530#1530
    [3078, 3415, -1, 0], // loc_1530#1530
    [3078, 3415, -1, 1], // loc_1530#1530
    [3081, 3427, 1, -1], // loc_1530#1530
    [3092, 3273, 0, 1], // loc_1530#1530
    [3092, 3273, 1, 1], // loc_1530#1530
    [3093, 3275, -1, -1], // loc_1530#1530
    [3159, 3441, 1, -1], // loc_1533#1533
    [3161, 3290, 1, -1], // loc_1553#1553
    [3161, 3440, -1, 0], // loc_1533#1533
    [3161, 3440, -1, 1], // loc_1533#1533
    [3164, 3290, -1, -1], // loc_1551#1551
    [3165, 3303, 1, -1], // loc_1516#1516
    [3168, 3303, -1, -1], // loc_1519#1519
    [3206, 3384, 0, 1], // loc_1530#1530
    [3206, 3384, 1, 1], // loc_1530#1530
    [3207, 3386, -1, -1], // loc_1530#1530
    [3209, 3458, 0, 1], // lockeddoor1#1591
    [3216, 3458, 0, 1], // lockeddoor1#1591
    [3216, 3477, -1, -1], // loc_1536#1536
    [3233, 3395, 1, 1], // loc_1530#1530
    [3233, 3397, 1, -1], // loc_1530#1530
    [3241, 3411, 1, 1], // loc_1530#1530
    [3243, 3451, -1, -1], // loc_1530#1530
];
