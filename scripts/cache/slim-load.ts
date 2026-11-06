// What scripts/cache/slim-cache.ts loads to find out which groups the game
// reads, with the game's own loaders, split into units that can run apart (in
// worker threads): each map, each batch of bakes, and the rest together.
//
// What a unit reads doesn't depend on what ran before it in the same worker,
// except that a loader may skip a group an earlier unit already read. That
// group is in the reads anyway, so the union of every unit's reads is the same
// whichever worker runs which unit, and in whatever order. A map takes out the
// ScapeRune squares an earlier one put in (they sit side by side, inside each
// other's margins), so it reads what a player who plays it first does.
import {
    GameAssets,
    PICKUP_OBJS,
    PILE_LOOKS,
    PLAYER_SEQS,
    getCharacterAppearance,
    getGameSpriteIds,
    getPlayerAttackSeqs,
    getPowerUpLookRequests,
} from "../../src/game/client/GameAssets";
import { getGameSoundIds } from "../../src/game/client/GameSounds";
import { CHARACTERS } from "../../src/game/content/characters";
import { ENEMIES } from "../../src/game/content/enemies";
import { CASKETS, GEAR, GEAR_SLOT_BY_ID, ITEMS } from "../../src/game/content/items";
import { ALL_MAPS, getArenaRegion } from "../../src/game/content/maps";
import { PASSIVES } from "../../src/game/content/passives";
import { PETS } from "../../src/game/content/pets";
import { POWER_UPS, THRALLS } from "../../src/game/content/powerups";
import { RANDOM_EVENTS } from "../../src/game/content/randomEvents";
import { SHOP_UPGRADES } from "../../src/game/content/shop";
import { getPlayerStanceSeqs } from "../../src/game/content/stances";
import { STAT_ICON_OBJ_IDS } from "../../src/game/content/statIcons";
import { COLLECTION_LOG_OBJ } from "../../src/game/content/titleIcons";
import { TROPHIES } from "../../src/game/content/trophies";
import { WEAPONS } from "../../src/game/content/weapons";
import { installRecipeInSceneBuilder } from "../../src/game/scaperune/squares";
import { LoadedCache } from "../../src/mapviewer/Caches";
import { ActorBakeLoader } from "../../src/mapviewer/webgl/actor/ActorBakeLoader";
import { BakeRequest } from "../../src/mapviewer/webgl/actor/ActorBakeTypes";
import { SdMapDataLoader } from "../../src/mapviewer/webgl/loader/SdMapDataLoader";
import { getSdTextureIds } from "../../src/mapviewer/webgl/loader/TextureIndex";
import { ItemIconLoader } from "../../src/mapviewer/worker/ItemIconLoader";
import { loadMinimapData } from "../../src/mapviewer/worker/MinimapData";
import { RegionDataLoader } from "../../src/mapviewer/worker/RegionDataLoader";
import { RenderDataLoader } from "../../src/mapviewer/worker/RenderDataLoader";
import { SoundLoader } from "../../src/mapviewer/worker/SoundLoader";
import { SpriteDataLoader } from "../../src/mapviewer/worker/SpriteDataLoader";
import {
    WorkerState,
    clearWorkerStateCaches,
    createWorkerState,
} from "../../src/mapviewer/worker/WorkerState";
import { MemoryStore } from "../../src/rs/cache/store/MemoryStore";
import { CustomMapFileLoader } from "../../src/rs/map/CustomMapFileLoader";
import {
    EquipSlot,
    PlayerAppearance,
    createAppearance,
} from "../../src/rs/model/player/PlayerModelLoader";
import { Scene } from "../../src/rs/scene/Scene";

// Map squares loaded around each arena. The camera can be up to ~15 tiles
// outside the arena and sees 72 tiles (GameApp's RENDER_DISTANCE), so the
// renderer asks for at most two squares past the edge.
const MAP_MARGIN = 2;

// Bake requests to put through one buffer
const BAKE_BATCH = 25;

// The map loaders draw minimap images on an OffscreenCanvas, which Node
// doesn't have. Only what they read from the cache matters here.
class NodeImageData {
    readonly data: Uint8ClampedArray;

    constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}
class NodeOffscreenCanvas {
    getContext() {
        return { putImageData() {} };
    }

    convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob());
    }
}
Object.assign(globalThis, { ImageData: NodeImageData, OffscreenCanvas: NodeOffscreenCanvas });

// Every group read since the last takeReads, as "index:archive"
const reads = new Set<string>();
const readGroup = MemoryStore.prototype.read;
MemoryStore.prototype.read = function (indexId: number, archiveId: number): Int8Array {
    reads.add(indexId + ":" + archiveId);
    return readGroup.call(this, indexId, archiveId);
};

export function takeReads(): string[] {
    const taken = [...reads];
    reads.clear();
    return taken;
}

type BakeGroup = "base" | "enemies" | "pets" | "players";

// A piece of what the game loads. Plain data, to be sent to a worker.
export type SlimUnit =
    | { kind: "map"; id: string }
    | { kind: "bake"; group: BakeGroup; from: number }
    | { kind: "rest" };

export function describeUnit(unit: SlimUnit): string {
    switch (unit.kind) {
        case "map":
            return `map ${unit.id}`;
        case "bake":
            return `${unit.group} bakes from ${unit.from}`;
        case "rest":
            return "textures, sounds, sprites and icons";
    }
}

// Every item the player can wear, in its slot: the outfits, held weapons, the
// pieces passives put on and casket gear
function getWornObjs(): [EquipSlot, number][] {
    const worn: [EquipSlot, number][] = [];
    for (const character of CHARACTERS) {
        for (const [slot, objId] of Object.entries(character.equipment)) {
            if (objId !== undefined) {
                worn.push([Number(slot), objId]);
            }
        }
    }
    // The fun maps' players (baked in getBaseRequests too)
    for (const enemy of ENEMIES) {
        for (const outfit of enemy.outfits ?? []) {
            for (const [slot, objId] of Object.entries(outfit.equipment)) {
                if (objId !== undefined && objId !== -1) {
                    worn.push([Number(slot), objId]);
                }
            }
        }
    }
    for (const weapon of WEAPONS) {
        for (const level of weapon.levels) {
            if (level.objId !== undefined) {
                worn.push([EquipSlot.WEAPON, level.objId]);
            }
        }
    }
    for (const passive of PASSIVES) {
        for (const piece of passive.equipment ?? []) {
            for (const objId of piece.objIds) {
                if (objId !== -1) {
                    worn.push([piece.slot, objId]);
                }
            }
        }
    }
    for (const gear of GEAR) {
        const equipSlot = GEAR_SLOT_BY_ID.get(gear.slot)?.equipSlot;
        if (equipSlot !== undefined) {
            worn.push([equipSlot, gear.objId]);
        }
    }
    return worn;
}

// Every item id in the content (objId, iconObjId, casketObjId, objIds...), for
// their icons
function getContentObjIds(): number[] {
    const ids = new Set<number>([
        COLLECTION_LOG_OBJ,
        ...Object.values(PICKUP_OBJS),
        ...Object.values(PILE_LOOKS).flatMap((looks) => looks.map((look) => look.objId)),
        ...STAT_ICON_OBJ_IDS,
    ]);
    for (const [, objId] of getWornObjs()) {
        ids.add(objId);
    }
    const seen = new Set<object>();
    const visit = (value: unknown, key: string): void => {
        if (typeof value === "number") {
            if (/objIds?$/i.test(key) && value >= 0) {
                ids.add(value);
            }
        } else if (value && typeof value === "object" && !seen.has(value)) {
            seen.add(value);
            for (const [childKey, child] of Object.entries(value)) {
                visit(child, Array.isArray(value) ? key : childKey);
            }
        }
    };
    visit(
        {
            CHARACTERS,
            ENEMIES,
            WEAPONS,
            PASSIVES,
            ITEMS,
            CASKETS,
            POWER_UPS,
            RANDOM_EVENTS,
            THRALLS,
            ALL_MAPS,
            SHOP_UPGRADES,
            TROPHIES,
        },
        "",
    );
    return [...ids];
}

// Stackables like coins have a model per stack size
function getStackCounts(state: WorkerState, objId: number): number[] {
    const counts = state.objTypeLoader.load(objId).countCo ?? [];
    return [1, ...counts.filter((count) => count > 1)];
}

function playerRequest(key: string, appearance: PlayerAppearance, seqIds: number[]): BakeRequest {
    return { kind: "player", key, appearance, seqIds };
}

function getPlayerRequests(): BakeRequest[] {
    const playerSeqs = [...Object.values(PLAYER_SEQS), ...getPlayerAttackSeqs()];
    return [
        // Every body kit
        playerRequest("bare", createAppearance(), playerSeqs),
        // Only the look holding the weapon plays these, so one bake reads them
        playerRequest("stances", createAppearance(), getPlayerStanceSeqs()),
        ...CHARACTERS.map((character) =>
            playerRequest(character.id, getCharacterAppearance(character.id), playerSeqs),
        ),
        // Power-ups' worn items and their animations
        ...getPowerUpLookRequests(createAppearance()),
        ...getWornObjs().map(([slot, objId]) =>
            playerRequest(`${slot}:${objId}`, createAppearance({ [slot]: objId }), []),
        ),
    ];
}

const bakeRequests = new Map<BakeGroup, BakeRequest[]>();

function getBakeRequests(group: BakeGroup): BakeRequest[] {
    let requests = bakeRequests.get(group);
    if (!requests) {
        requests =
            group === "base"
                ? GameAssets.getBaseRequests()
                : group === "enemies"
                  ? GameAssets.getEnemyRequests(ENEMIES)
                  : // Pets are baked as they're picked, not with the base: every one of them
                    group === "pets"
                    ? GameAssets.getPetRequests(PETS)
                    : getPlayerRequests();
        bakeRequests.set(group, requests);
    }
    return requests;
}

type MapSquares = {
    plane: number;
    firstX: number;
    firstY: number;
    lastX: number;
    lastY: number;
};

function getMapSquares(mapId: string): MapSquares {
    const map = ALL_MAPS.find((m) => m.id === mapId);
    if (!map) {
        throw new Error(`No map ${mapId}`);
    }
    const { baseX, baseY, sizeX, sizeY, plane } = getArenaRegion(map);
    return {
        plane,
        firstX: Math.floor(baseX / Scene.MAP_SQUARE_SIZE),
        firstY: Math.floor(baseY / Scene.MAP_SQUARE_SIZE),
        lastX: Math.ceil((baseX + sizeX) / Scene.MAP_SQUARE_SIZE) - 1,
        lastY: Math.ceil((baseY + sizeY) / Scene.MAP_SQUARE_SIZE) - 1,
    };
}

// Everything the game loads, as units: the maps first, biggest first, as they
// take longest, so that a pool of workers finishes about together
export function getSlimUnits(): SlimUnit[] {
    const squares = (id: string) => {
        const { firstX, firstY, lastX, lastY } = getMapSquares(id);
        return (lastX - firstX + 1 + 2 * MAP_MARGIN) * (lastY - firstY + 1 + 2 * MAP_MARGIN);
    };
    const maps = ALL_MAPS.map((map) => map.id).sort((a, b) => squares(b) - squares(a));
    const bakes: SlimUnit[] = [];
    for (const group of ["enemies", "players", "base", "pets"] as const) {
        for (let from = 0; from < getBakeRequests(group).length; from += BAKE_BATCH) {
            bakes.push({ kind: "bake", group, from });
        }
    }
    return [...maps.map((id): SlimUnit => ({ kind: "map", id })), ...bakes, { kind: "rest" }];
}

// The map loader logs every square
async function quietly<T>(load: () => Promise<T>): Promise<T> {
    const { log, time, timeEnd } = console;
    console.log = console.time = console.timeEnd = () => {};
    try {
        return await load();
    } finally {
        Object.assign(console, { log, time, timeEnd });
    }
}

// Loads units from one cache, as the game would
export class SlimLoader {
    private readonly state: WorkerState;
    private readonly bakeLoader = new ActorBakeLoader();
    private readonly mapLoader = new SdMapDataLoader();

    constructor(cache: LoadedCache) {
        this.state = createWorkerState(cache, [], [], undefined as unknown as Cache);
    }

    private async load<I, D>(loader: RenderDataLoader<I, D>, input: I): Promise<void> {
        loader.init();
        await loader.load(this.state, input);
        clearWorkerStateCaches(this.state);
    }

    async run(unit: SlimUnit): Promise<void> {
        switch (unit.kind) {
            case "map":
                return this.loadMap(unit.id);
            case "bake": {
                // The game bakes a map's worth at a time. Everything in one buffer is
                // more than an array can hold (Invalid array length).
                const requests = getBakeRequests(unit.group).slice(
                    unit.from,
                    unit.from + BAKE_BATCH,
                );
                return this.load(this.bakeLoader, {
                    requests,
                    loadedTextureIds: new Set<number>(),
                });
            }
            case "rest":
                return this.loadRest();
        }
    }

    private async loadRest(): Promise<void> {
        const state = this.state;
        // The renderer's texture array
        for (const id of getSdTextureIds(state.textureLoader)) {
            state.textureLoader.getPixelsArgb(id, 128, true, 1.0);
        }
        await this.load(new SoundLoader(), { ids: getGameSoundIds() });
        await this.load(new SpriteDataLoader(), { spriteIds: getGameSpriteIds() });
        await this.load(new ItemIconLoader(), {
            requests: getContentObjIds().flatMap((objId) =>
                getStackCounts(state, objId).map((count) => ({ objId, count })),
            ),
        });
    }

    private async loadMap(mapId: string): Promise<void> {
        const map = ALL_MAPS.find((m) => m.id === mapId)!;
        const mapFiles = this.state.sceneBuilder.mapFileLoader;
        if (mapFiles instanceof CustomMapFileLoader) {
            mapFiles.squares.clear();
        }
        installRecipeInSceneBuilder(this.state.sceneBuilder, map.id);
        await this.load(new RegionDataLoader(), getArenaRegion(map));

        const { plane, firstX, firstY, lastX, lastY } = getMapSquares(mapId);
        for (let mapX = firstX - MAP_MARGIN; mapX <= lastX + MAP_MARGIN; mapX++) {
            for (let mapY = firstY - MAP_MARGIN; mapY <= lastY + MAP_MARGIN; mapY++) {
                // GameWebGLRenderer's settings
                await quietly(() =>
                    this.load(this.mapLoader, {
                        mapX,
                        mapY,
                        minLevel: plane,
                        maxLevel: plane,
                        loadObjs: false,
                        loadNpcs: false,
                        smoothTerrain: false,
                        minimizeDrawCalls: false,
                        loadedTextureIds: new Set<number>(),
                    }),
                );
            }
        }
        // The minimap's images
        for (let mapX = firstX; mapX <= lastX; mapX++) {
            for (let mapY = firstY; mapY <= lastY; mapY++) {
                await loadMinimapData(this.state, mapX, mapY, plane, true);
            }
        }
    }
}
