// the exit portal of an instanced interior (rune altars), from the loc scene
import * as locScene from './loc-scene.js';

/** Nearest usable portal (op Use/Enter/Exit) inside an instanced interior, from the loc scene; null if none/unready. */
export function nearestInteriorPortal(x: number, z: number): { x: number; z: number; loc: number; op: number }
