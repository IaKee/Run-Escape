import { describe, expect, test } from "vitest";

import { BakeRequest } from "../../mapviewer/webgl/actor/ActorBakeTypes";
import {
    EquipSlot,
    createAppearance,
    getAppearanceKey,
} from "../../rs/model/player/PlayerModelLoader";
import { CHARACTERS } from "../content/characters";
import { REVIVE_SEQ } from "../content/coop";
import { ENEMIES, getEnemy } from "../content/enemies";
import { getMapEnemies } from "../content/mapEnemies";
import { ALL_MAPS, getMap } from "../content/maps";
import { PASSIVES } from "../content/passives";
import { POWER_UPS, getPowerUp } from "../content/powerups";
import { RANDOM_EVENTS, VISITOR_SPOTANIM } from "../content/randomEvents";
import { LOCK_SPRITE, STAT_ICON_SPRITE_IDS } from "../content/statIcons";
import { emptyStats } from "../content/types";
import { WEAPONS, getWeapon } from "../content/weapons";
import { Sim } from "../core/Sim";
import { makeGrid } from "../core/world/testGrid";
import {
    GAME_VIEW_SPRITES,
    GameAssets,
    HINT_ARROW_SPRITE,
    PRAYER_HEADICON_FRAME_IDS,
    PRAYER_HEADICON_SPRITE,
    getCharacterAppearance,
    getCharacterAttackSeqs,
    getEnemyModelKey,
    getGameSpriteIds,
    getLookKey,
    getOfferedAttackSeqs,
    getPlayerAttackSeqs,
    getPowerUpLookRequests,
    getPrayerHeadicon,
    getRunAttackSeqs,
    getShieldedModelKey,
    getStatueModelKey,
    lookHas,
} from "./GameAssets";
import { getGameSoundIds } from "./GameSounds";

describe("enemy bakes", () => {
    test("bake an arena fight's statues and jets with every animation its attacks play", () => {
        const phosani = getEnemy("phosanis_nightmare");
        const attack = phosani.boss!.attacks[0];
        const boss = {
            ...phosani,
            boss: {
                ...phosani.boss!,
                phases: {
                    ...phosani.boss!.phases!,
                    threshold: { seconds: 2, seq: 7965, riseSeq: 7962 },
                },
                attacks: [
                    { ...attack, statues: { locId: 38445, windupSeq: 8682, seq: 8684 } },
                    {
                        ...attack,
                        statues: { locId: 38432, windupSeq: 8667 },
                        boomerang: { reach: 20, catchSeq: 8668 },
                    },
                    {
                        ...attack,
                        cycle: {
                            period: 4,
                            stagger: 1,
                            warn: 1,
                            burn: 1,
                            out: 1,
                            interval: 1,
                            locId: 38427,
                            seqs: { warn: 8661, burn: 8662, out: 8663 },
                        },
                    },
                ],
            },
        };
        const requests = GameAssets.getEnemyRequests([boss]);
        const seqs = (key: string) => {
            const request = requests.find((r) => r.key === key);
            return request?.kind === "loc" ? request.seqs : undefined;
        };
        expect(seqs(getStatueModelKey(38445))).toEqual([-1, 8682, 8684]);
        expect(seqs(getStatueModelKey(38432))).toEqual([-1, 8667, 8668]);
        expect(seqs(getStatueModelKey(38427))).toEqual([-1, 8661, 8662, 8663]);
        const npc = requests.find((r) => r.key === getEnemyModelKey(boss, 0));
        expect(npc?.kind === "npc" && npc.seqIds).toEqual(expect.arrayContaining([7965, 7962]));
    });

    test("have every model GameView asks for", () => {
        for (const enemy of ENEMIES) {
            const keys = GameAssets.getEnemyRequests([enemy]).map((r) => r.key);
            const variants = enemy.outfits?.length ?? 1;
            for (let variant = 0; variant < variants; variant++) {
                expect(keys).toContain(getEnemyModelKey(enemy, variant));
            }
            if (enemy.shield?.look) {
                expect(keys).toContain(getShieldedModelKey(enemy));
            }
        }
    });

    test("every spot animation a boss attack shows is in the base bake", () => {
        const keys = GameAssets.getBaseRequests().map((r) => r.key);
        for (const enemy of ENEMIES) {
            for (const attack of enemy.boss?.attacks ?? []) {
                for (const id of attack.impactSpotAnims ?? []) {
                    expect(keys).toContain("spot:" + id);
                }
                if (attack.pool) {
                    expect(keys).toContain("loc:" + attack.pool.locId);
                }
            }
            for (const id of enemy.disguise?.warning?.spotAnims ?? []) {
                expect(keys).toContain("spot:" + id);
            }
        }
    });

    test("aren't in the base bake", () => {
        const keys = GameAssets.getBaseRequests().map((r) => r.key);
        expect(keys).not.toContain("npc:goblin");
    });
});

// A request without its key and animations
function getBody(request: BakeRequest): Partial<BakeRequest> {
    const { key: _key, ...body } = request;
    return "seqIds" in body ? { ...body, seqIds: body.seqIds.slice(0, 1) } : body;
}

describe("merged enemy bakes", () => {
    const maps = ALL_MAPS.map((map) => ({
        map,
        requests: GameAssets.getEnemyRequests(getMapEnemies(map)),
    }));

    test("still have every model GameView asks for, on every map", () => {
        for (const { requests } of maps) {
            const merged = GameAssets.mergeRequests(requests);
            const keys = new Set(merged.requests.map((r) => r.key));
            for (const { key } of requests) {
                expect(keys.has(key) || keys.has(merged.aliases.get(key)!)).toBe(true);
            }
        }
    });

    test("merge only requests that bake the same model, with all their animations", () => {
        for (const { requests } of maps) {
            const merged = GameAssets.mergeRequests(requests);
            const byKey = new Map(merged.requests.map((r) => [r.key, r]));
            for (const request of requests) {
                const into = byKey.get(merged.aliases.get(request.key) ?? request.key)!;
                expect(getBody(into)).toEqual(getBody(request));
                if ("seqIds" in request && "seqIds" in into) {
                    expect(into.seqIds[0]).toBe(request.seqIds[0]);
                    for (const seqId of request.seqIds) {
                        expect(into.seqIds).toContain(seqId);
                    }
                }
            }
        }
    });

    test("don't change the requests they're made from", () => {
        const requests = GameAssets.getEnemyRequests(getMapEnemies(getMap("god_wars")));
        const copy = structuredClone(requests);
        GameAssets.mergeRequests(requests);
        expect(requests).toEqual(copy);
    });

    test("bake Nex once for her four phases", () => {
        const { requests, aliases } = GameAssets.mergeRequests(
            GameAssets.getEnemyRequests(getMapEnemies(getMap("god_wars"))),
        );
        const nex = getEnemy("nex");
        expect(requests.filter((r) => r.kind === "npc" && r.npcId === nex.npcId)).toHaveLength(1);
        for (const id of ["nex_shadow", "nex_blood", "nex_ice"]) {
            expect(aliases.get("npc:" + id)).toBe("npc:nex");
        }
    });

    test("never have one key for two different models", () => {
        const lots = [GameAssets.getBaseRequests(), ...maps.map((m) => m.requests)];
        for (const requests of lots) {
            const bodies = new Map<string, Partial<BakeRequest>>();
            for (const request of requests) {
                const body = bodies.get(request.key);
                if (body) {
                    expect(getBody(request)).toEqual(body);
                }
                bodies.set(request.key, getBody(request));
            }
        }
    });
});

describe("bake tasks", () => {
    test("have every request once, an NPC or player model to a task", () => {
        const requests = [...GameAssets.getBaseRequests(), ...GameAssets.getEnemyRequests(ENEMIES)];
        const tasks = GameAssets.getBakeTasks(requests);
        expect(tasks.flat()).toHaveLength(requests.length);
        expect(new Set(tasks.flat())).toEqual(new Set(requests));
        for (const task of tasks) {
            if (task.some((r) => r.kind === "npc" || r.kind === "player")) {
                expect(task).toHaveLength(1);
            }
        }
    });
});

describe("player bakes", () => {
    function createRun(party: number, hero = CHARACTERS[0].id): Sim {
        return new Sim({
            grid: makeGrid(["....", "....", "....", "...."], 1000, 1000),
            characterId: hero,
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1001.5,
            spawnY: 1001.5,
            party: Array.from({ length: party }, (_, i) => ({
                name: "p" + i,
                characterId: hero,
                metaStats: emptyStats(),
            })),
        });
    }

    test("have the swings of the weapons the hero holds", () => {
        const sim = createRun(1);
        const start = getWeapon(CHARACTERS[0].startingWeapon);
        expect(getRunAttackSeqs(sim)).toEqual([start.playerSeq]);
        const special = WEAPONS.find(
            (w) =>
                w.special?.playerSeq !== undefined &&
                w.special.playerSeq !== w.playerSeq &&
                w.playerSeq !== start.playerSeq,
        )!;
        sim.addWeapon(special.id);
        expect(getRunAttackSeqs(sim)).toEqual([
            start.playerSeq,
            special.playerSeq,
            special.special!.playerSeq,
        ]);
        expect(getRunAttackSeqs(sim)).not.toContain(REVIVE_SEQ);
    });

    test("a look asked for again while another bakes keeps it, not the other (Retry)", async () => {
        // The bake itself, faked: each look's model, once it's let go
        const waiting = new Map<string, () => void>();
        const assets: GameAssets = Object.create(GameAssets.prototype);
        Object.assign(assets, {
            players: [],
            actors: { removePage() {} },
            bakeLook: (key: string) =>
                new Promise((resolve) =>
                    waiting.set(key, () =>
                        resolve({ models: new Map([["player", { page: key }]]), stance: {} }),
                    ),
                ),
        });
        const fight = getCharacterAppearance("saradominist");
        const menus = getCharacterAppearance(CHARACTERS[0].id);
        const first = assets.setPlayerAppearance(fight);
        [...waiting.values()][0]();
        await first;
        const page = () => (assets.getPlayer() as unknown as { page: string }).page;
        const saradominist = page();
        // The run ends: the menus' look starts baking. Retry: the fight's look again.
        const back = assets.setPlayerAppearance(menus);
        await assets.setPlayerAppearance(fight);
        [...waiting.values()][1]();
        await back;
        expect(page()).toBe(saradominist);
    });

    test("on the menus have what a solo run starts with, so it needn't bake again", () => {
        for (const character of CHARACTERS) {
            const sim = createRun(1, character.id);
            expect(getRunAttackSeqs(sim)).toEqual(getCharacterAttackSeqs(character.id));
        }
    });

    test("bake the swings a level-up offers ahead, and not ones held", () => {
        const sim = createRun(1);
        const start = getWeapon(CHARACTERS[0].startingWeapon);
        const whip = getWeapon("abyssal_whip");
        expect(getOfferedAttackSeqs(sim)).toEqual([]);
        sim.choices = [
            { kind: "newWeapon", weaponId: whip.id, quality: "common" },
            { kind: "newWeapon", weaponId: start.id, quality: "common" },
            { kind: "coins", amount: 25 },
        ];
        const swings = [whip.playerSeq, whip.special?.playerSeq].filter((id) => id !== undefined);
        expect(getOfferedAttackSeqs(sim)).toEqual([...new Set(swings)]);
    });

    test("a look with more swings than asked for does", () => {
        const appearance = createAppearance({ [EquipSlot.WEAPON]: 1277 });
        const key = getAppearanceKey(appearance);
        const look = getLookKey(appearance, [390, 1658]);
        expect(lookHas(look, key, [1658])).toBe(true);
        expect(lookHas(look, key, [1658, 390])).toBe(true);
        expect(lookHas(look, key, [])).toBe(true);
        expect(lookHas(look, key, [7045])).toBe(false);
        const other = getAppearanceKey(createAppearance({ [EquipSlot.WEAPON]: 1289 }));
        expect(lookHas(look, other, [390])).toBe(false);
        expect(lookHas(getLookKey(appearance, []), key, [])).toBe(true);
        expect(lookHas(undefined, key, [])).toBe(false);
    });

    test("in co-op have the reviver's emote", () => {
        expect(getRunAttackSeqs(createRun(2), 1)).toContain(REVIVE_SEQ);
    });

    test("are all in what the slim cache keeps", () => {
        const all = getPlayerAttackSeqs();
        for (const character of CHARACTERS) {
            const weapon = getWeapon(character.startingWeapon);
            expect(all).toContain(weapon.playerSeq);
        }
        expect(all).toContain(REVIVE_SEQ);
    });
});

describe("power-ups in the cache", () => {
    test("a look puts its item in hand, takes the shield off and leaves the rest", () => {
        const appearance = createAppearance({
            [EquipSlot.WEAPON]: 1277,
            [EquipSlot.SHIELD]: 1171,
            [EquipSlot.HEAD]: 1153,
        });
        const [request] = getPowerUpLookRequests(appearance);
        const { look } = getPowerUp("sled");
        expect(request).toMatchObject({
            kind: "player",
            key: "player:sled",
            seqIds: [look!.idleSeq, look!.moveSeq],
        });
        const worn = request.kind === "player" ? request.appearance.equipment : [];
        expect(worn[EquipSlot.WEAPON]).toBe(look!.objId);
        expect(worn[EquipSlot.SHIELD]).toBe(-1);
        expect(worn[EquipSlot.HEAD]).toBe(1153);
        // The player's own look is left as it was
        expect(appearance.equipment[EquipSlot.WEAPON]).toBe(1277);
    });

    test("what their effects draw is baked, so the slim cache gets it", () => {
        const keys = new Set(GameAssets.getBaseRequests().map((r) => r.key));
        for (const { id, effect, objId, locId } of POWER_UPS) {
            expect(keys).toContain(locId !== undefined ? "loc:" + locId : "obj:" + objId);
            if ("locId" in effect) {
                expect(keys).toContain("loc:" + effect.locId);
            }
            if ("spotAnim" in effect) {
                expect(keys).toContain("spot:" + effect.spotAnim);
            }
            if (effect.kind === "rampage") {
                expect(keys).toContain("rampage:" + id);
            }
        }
    });

    test("random events' visitors are baked", () => {
        const keys = GameAssets.getBaseRequests().map((request) => request.key);
        for (const { id, npcId } of RANDOM_EVENTS) {
            if (npcId !== undefined) {
                expect(keys).toContain("visitor:" + id);
            }
        }
        expect(keys).toContain("spot:" + VISITOR_SPOTANIM);
    });

    // Every level's, not only the first: the Toxic blowpipe's darts change as it levels
    test("weapons' spot animations are baked at every level, so the slim cache gets them", () => {
        const keys = new Set(GameAssets.getBaseRequests().map((r) => r.key));
        for (const weapon of WEAPONS) {
            for (const level of weapon.levels) {
                const ids = [level.castSpotAnim, level.projectileSpotAnim, level.impactSpotAnim];
                for (const id of ids) {
                    if (id !== undefined) {
                        expect(keys, weapon.id).toContain("spot:" + id);
                    }
                }
            }
        }
    });

    test("Toktz-mej-tal's fire is baked with its animation", () => {
        const { burns } = getWeapon("toktz_mej_tal");
        const request = GameAssets.getBaseRequests().find((r) => r.key === "loc:" + burns!.locId);
        expect(request).toEqual({
            kind: "loc",
            key: "loc:" + burns!.locId,
            locId: burns!.locId,
            animated: true,
        });
    });

    test("their sounds are all loaded", () => {
        const sounds = getGameSoundIds();
        for (const { sound, endSound, hitSound } of POWER_UPS) {
            for (const id of [sound, endSound, hitSound]) {
                if (id !== undefined && id !== -1) {
                    expect(sounds).toContain(id);
                }
            }
        }
    });
});

describe("sprites", () => {
    test("the slim cache keeps every sprite the game view loads", async () => {
        const asked: { spriteIds: number[]; frames?: number[] }[] = [];
        const workerPool = {
            queueLoad: async (
                _loader: unknown,
                input: { spriteIds: number[]; frames?: number[] },
            ) => {
                asked.push(input);
                return [];
            },
        };
        const assets = new GameAssets(workerPool as never, undefined as never, undefined as never);
        await assets.loadSprites();
        // The game view's first frames, then each overhead prayer's frame
        const headicons = PRAYER_HEADICON_FRAME_IDS.map(() => PRAYER_HEADICON_SPRITE);
        expect(asked).toEqual([
            {
                spriteIds: [...GAME_VIEW_SPRITES, ...headicons],
                frames: [...GAME_VIEW_SPRITES.map(() => 0), ...PRAYER_HEADICON_FRAME_IDS],
            },
        ]);
        expect(GAME_VIEW_SPRITES).toContain(HINT_ARROW_SPRITE);
        expect(getGameSpriteIds()).toEqual(expect.arrayContaining(asked[0].spriteIds));
    });

    test("the slim cache keeps every stat icon's sprite and the padlock", () => {
        const ids = getGameSpriteIds();
        expect(STAT_ICON_SPRITE_IDS).toContain(LOCK_SPRITE);
        expect(ids).toEqual(expect.arrayContaining(STAT_ICON_SPRITE_IDS));
    });

    test("the slim cache keeps every passive's icon", () => {
        const ids = getGameSpriteIds();
        for (const { iconSpriteId } of PASSIVES) {
            if (iconSpriteId !== undefined) {
                expect(ids).toContain(iconSpriteId);
            }
        }
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe("a boss's overhead prayer", () => {
    test("has a frame for each style and pair, whichever way round, that the client loads", () => {
        // A pair's the same frame whichever way round it's listed, and not either one's own
        const pair = getPrayerHeadicon(["ranged", "magic"]);
        expect(pair).toBeDefined();
        expect(getPrayerHeadicon(["magic", "ranged"])).toBe(pair);
        expect(pair).not.toBe(getPrayerHeadicon(["ranged"]));
        expect(pair).not.toBe(getPrayerHeadicon(["magic"]));
        // Every frame it can give is one the client loads (and sprites.ts check finds drawn)
        const asked = [
            ["melee"],
            ["ranged"],
            ["magic"],
            ["ranged", "magic"],
            ["melee", "magic"],
            ["melee", "ranged"],
        ];
        for (const styles of asked) {
            expect(getPrayerHeadicon(styles)).toBeDefined();
            expect(PRAYER_HEADICON_FRAME_IDS).toContain(getPrayerHeadicon(styles));
        }
    });

    test("is the frame sprite 440 draws that prayer, or pair, in", () => {
        // Pinned from the cache (sprites.ts png 440): a swapped pair would show green Nylocas
        // Vasilias the wrong prayers, and sprites.ts check only finds a frame drawn
        expect(getPrayerHeadicon(["melee"])).toBe(0);
        expect(getPrayerHeadicon(["ranged"])).toBe(1);
        expect(getPrayerHeadicon(["magic"])).toBe(2);
        expect(getPrayerHeadicon(["ranged", "magic"])).toBe(6);
        expect(getPrayerHeadicon(["melee", "ranged"])).toBe(7);
        expect(getPrayerHeadicon(["melee", "magic"])).toBe(8);
    });
});
