import { Camera } from "../../mapviewer/Camera";
import { MapViewer } from "../../mapviewer/MapViewer";
import { ActorRenderer } from "../../mapviewer/webgl/actor/ActorRenderer";
import { RegionData, RegionDataInput } from "../../mapviewer/worker/RegionData";
import { RegionDataLoader } from "../../mapviewer/worker/RegionDataLoader";
import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { isCoarsePointer } from "../../util/DeviceUtil";
import { CHARACTERS, getCharacter } from "../content/characters";
import { MAX_PARTY, REVIVE_IMMUNITY_SECONDS, REVIVE_SECONDS } from "../content/coop";
import { upgradedName } from "../content/endless";
import { getEnemy } from "../content/enemies";
import { CASKETS, getItem } from "../content/items";
import { getMapEnemies } from "../content/mapEnemies";
import {
    FUN_MAPS,
    MAPS,
    MAP_BY_ID,
    RAID_MAPS,
    getArenaRegion,
    getMap,
    getMapCharacter,
    isDevMap,
    isFunMap,
} from "../content/maps";
import { formatPassiveValue, getPassive } from "../content/passives";
import { PET_BY_ID, isPetFound } from "../content/pets";
import { getPowerUp } from "../content/powerups";
import { QUESTS, canDoQuestOn, describeQuest } from "../content/quests";
import { getRaidBossShare, raidHasColours } from "../content/raidBosses";
import { RAID_TELEPORTS } from "../content/raids";
import { RARITIES, Rarity } from "../content/rarity";
import { SHOP_UPGRADES } from "../content/shop";
import { formatStats } from "../content/stats";
import { TROPHY_BY_ID } from "../content/trophies";
import { CombatStyle, Stats, emptyStats } from "../content/types";
import { LOCKABLE_ITEMS, describeUnlockTask, isAvailable } from "../content/unlocks";
import { formatWeaponBonus, formatWeaponStat, weaponStats } from "../content/weaponStats";
import { getWeapon, getWeaponStyle } from "../content/weapons";
import { ChestAction, shouldAutoEquip } from "../core/Loot";
import { Hero, HeroOptions, Sim, TICKS_PER_SECOND } from "../core/Sim";
import { UpgradeChoice, canEvolve, describeChoice, getEvolutionHint } from "../core/Upgrades";
import { Enemy, SimEvent, WeaponState } from "../core/entities";
import { usePortableMath } from "../core/fmath";
import { CoopAction, applyAction, hasBadNumber } from "../core/lockstep";
import {
    NewerSave,
    SaveData,
    SaveStore,
    buyArmouryUpgrade,
    buyUpgrade,
    exportSave,
    getEarnedUnlocks,
    getFinishedQuests,
    getMetaStats,
    getQuestProgress,
    getRaidPortals,
    getStartingCharacter,
    isEndlessRecord,
    isEndlessUnlocked,
    isExpertUnlocked,
    isHardUnlocked,
    isMapUnlocked,
    recordRun,
    refundUpgrade,
    refundUpgrades,
} from "../core/save";
import { ArenaGrid } from "../core/world/ArenaGrid";
import { CameraRig, MAX_CAMERA_DISTANCE, getGroundReach } from "../render/CameraRig";
import { CameraReach, GameFrameHandler, GameWebGLRenderer } from "../render/GameWebGLRenderer";
import { installRecipe } from "../scaperune/squares";
import { OVERHEAD_GAP, OVERHEAD_SCALE } from "./BossFightView";
import { DamageMeter } from "./DamageMeter";
import {
    DisplaySettings,
    FrameRate,
    frameCap,
    loadDisplaySettings,
    saveDisplaySettings,
} from "./DisplaySettings";
import {
    GameAssets,
    PRAYER_HEADICON_FRAME_IDS,
    PRAYER_HEADICON_SPRITE,
    getEnemyModelKey,
    getOfferedAttackSeqs,
    getRunAppearance,
    getRunAttackSeqs,
} from "./GameAssets";
import { GameAudio } from "./GameAudio";
import { GameInput } from "./GameInput";
import { ChestCue, GameSounds, getGameSoundIds } from "./GameSounds";
import {
    AbilityView,
    ChoiceView,
    GameStore,
    HudNumbers,
    HudView,
    QuestTrackView,
    ReviveView,
    SaveBlock,
    Screen,
    SlotView,
    shareUnchanged,
} from "./GameStore";
import { GameView } from "./GameView";
import {
    getBuffViews,
    getChestView,
    getEventView,
    getGearViews,
    getInventoryViews,
} from "./ItemViews";
import { Minimap } from "./Minimap";
import { Overlay, ScreenPoint } from "./Overlay";
import { getPlayerPose } from "./PlayerPose";
import { RUN_ANALYTICS_URL, startRunAnalytics } from "./RunAnalytics";
import { getBossKillViews, getPlayerResultViews } from "./RunStatsViews";
import { SaveLock } from "./SaveLock";
import { CoopLobby, makeLoadout } from "./coop/CoopLobby";
import { CoopRun, GUEST_BUFFER_FRAMES } from "./coop/CoopRun";
import { GameStart, GoneReason, Loadout, RoomView, Unlocks, isGameStart } from "./coop/protocol";
import { saveFile } from "./saveFile";

// 20ms: the OSRS client tick, also the unit of animation frame lengths
export const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME = 10;
// A solo run makes up a late frame's ticks this many a frame at most, rather than
// all in the next one, so one slow frame doesn't make the next slow too. Every
// tick still runs: it's at most MAX_TICKS_PER_FRAME behind, as before.
const SOLO_TICKS_PER_FRAME = 4;
// A co-op guest that's fallen well behind the host catches up this fast
const MAX_CATCH_UP_TICKS = 120;
// A frame spends this long at most on catching up, so a slow phone stays
// responsive while it does (the ticks that are due in real time still run)
const CATCH_UP_BUDGET_MS = 8;
// What can wait for a co-op run whose copy is still being made: far more
// than a slow load brings in
const MAX_COOP_INBOX = 50_000;
const HUD_INTERVAL_MS = 100;
// Co-op: how much nearer, in tiles, another boss must be to take the boss bar, so two
// about as far away don't take turns on it as everyone moves
const BOSS_BAR_SWITCH = 2;
// The damage meter's number holds this long, so it can be read
const DPS_HOLD_TICKS = TICKS_PER_SECOND / 2;

// The title screen is in the first map (Lumbridge castle's courtyard)
const TITLE_MAP = MAPS[0];

// Recordings of the OSRS music tracks maps play (MapDef.music), from the OSRS
// Wiki, in src/media/music: a track's file is its name in lower case with
// underscores (massacre.ogg, the_bane_of_ashihama.ogg). A track with no
// recording there plays nothing, so a map can name one before it's in.
const MUSIC_FILES = import.meta.glob("../../media/music/*.ogg", {
    eager: true,
    import: "default",
}) as Record<string, string>;

function musicFor(track: string): string | undefined {
    const file = track.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return MUSIC_FILES[`../../media/music/${file}.ogg`];
}

// Title screen camera: lower and slowly circling the character (RS angle units
// per tick), or settling in front of them when it's not to spin
const ATTRACT_PITCH = -260;
const ATTRACT_DISTANCE = 9;
const ATTRACT_SPIN = 1.2;
const ATTRACT_SETTLE = 0.96;
// The pet taken along stands beside the character on the menus: tiles to their side and behind
const PREVIEW_PET_SIDE = 1.1;
const PREVIEW_PET_BACK = 0.4;
const RUN_PITCH = -400;
// Tiles past a dev map's arena the world's drawn: a map square of scenery, less a fade
const OPEN_WORLD_MARGIN = 56;
const RUN_DISTANCE = 18;
// How long the camera takes to follow the ground up a slope on a dev map, in ms: without this,
// it lurches at every crease in tall ground
const CAMERA_GROUND_EASE = 110;
// For a boss that asks for it (BossLookDef.lean), the camera leans this much of the way towards
// where it stands, up to so many tiles, so a big boss isn't under the HUD at the top; and how long
// that takes, in ms (the ease is a raid boss room's too). A raid's boss rooms lean only as far
// as they need (RAID_LEAN_MAX): players there would rather it stayed on them.
const BOSS_LEAN = 0.4;
const BOSS_LEAN_MAX = 2.5;
const BOSS_LEAN_EASE = 350;
// In a raid's boss room the camera stays on the player, as in the halls, leaning north only as
// far as keeps the boss and its overhead prayer below the boss bar (a big boss on a phone's short
// screen most of all), and only when that's no more than this many tiles: a boss further off
// isn't leant towards
const RAID_LEAN_MAX = 4;
// How much brighter a gaze lights the arena at its height (getGazeLight)
const GAZE_LIGHT = 0.6;
// Ms the light takes to catch up with that, roughly
const GAZE_LIGHT_EASE = 180;
// A boss's blow shaking the camera (ImpactDef.shake): how long, how far at its hardest (tiles),
// and from how many tiles off the player it's felt less, to none at SHAKE_FAR
const SHAKE_MS = 320;
const SHAKE_TILES = 0.3;
const SHAKE_NEAR = 8;
const SHAKE_FAR = 24;
// Closer on a phone held sideways: it shows as much to each side as a desktop
// window does, and the player stays big enough to see
const PHONE_RUN_DISTANCE = 15;
const PHONE_MAX_HEIGHT = 520;

// How far past the arena the camera can get: a run's is behind the player, zoomed
// all the way out, and the title screen's circles them
const CAMERA_REACH: CameraReach = {
    behind: getGroundReach(RUN_PITCH, MAX_CAMERA_DISTANCE),
    around: getGroundReach(ATTRACT_PITCH, ATTRACT_DISTANCE),
};

// The world fades out past the arena's edge. A ScapeRune map's world carries on: it
// has scenery there (scaperune/CLAUDE.md).
function setPlayArea(
    renderer: GameWebGLRenderer,
    arena: { baseX: number; baseY: number; sizeX: number; sizeY: number },
    scaperune: boolean,
): void {
    const { baseX, baseY, sizeX, sizeY } = arena;
    const open = scaperune ? OPEN_WORLD_MARGIN : 0;
    renderer.setPlayArea(
        baseX - open,
        baseY - open,
        baseX + sizeX + open,
        baseY + sizeY + open,
        CAMERA_REACH,
    );
}

// The level up's rewards, as the UI shows them
// What a new endless round brings, for its toast
function describeRound(sim: Sim): string {
    const times = (n: number) => `${Math.round(n * 10) / 10}x`;
    return (
        `Round ${sim.round} begins! Monsters have ${times(sim.roundHp)} the hitpoints and hit ` +
        `${times(sim.roundDamage)} as hard, and caskets' gear comes +${sim.round - 1}.`
    );
}

function getQuestTrackViews(save: SaveData, sim: Sim): QuestTrackView[] {
    // Quests don't count on the fun maps, so there's nothing to track there
    if (isFunMap(sim.map.id)) {
        return [];
    }
    const run = sim.getResult();
    const quests = QUESTS.filter(
        (quest) => canDoQuestOn(quest, sim.map) && !save.questsDone.includes(quest.id),
    );
    // The map's own first (QUESTS has the ones done all over last)
    return quests.map((quest) => {
        const { done, of } = getQuestProgress(save, quest, run);
        return {
            id: quest.id,
            name: quest.name,
            task: describeQuest(quest.objective),
            done,
            of,
            finished: done >= of,
        };
    });
}

// How far a weapon has got towards its evolution, for the HUD and pause menu
function getEvolutionView(sim: Sim, weapon: WeaponState): SlotView["evolution"] {
    const evolution = weapon.def.evolution;
    if (!evolution || !isAvailable(getWeapon(evolution.into), sim.unlockedItems)) {
        return undefined;
    }
    const owned = new Set(sim.passives.map((p) => p.id));
    return {
        passive: getPassive(evolution.requiresPassive).name,
        maxed: weapon.level >= weapon.def.levels.length,
        hasPassive: owned.has(evolution.requiresPassive),
        ready: canEvolve(weapon, owned, sim.unlockedItems),
    };
}

// A raid whose bosses all pray against a weapon's style (the Theatre's, against ranged and
// magic): what its card says it loses against them
function getBossPenalty(sim: Sim, choice: UpgradeChoice): string | undefined {
    const weaponId =
        choice.kind === "evolve" || choice.kind === "hilt"
            ? choice.into
            : choice.kind === "newWeapon" || choice.kind === "weaponLevel"
              ? choice.weaponId
              : undefined;
    if (!weaponId) {
        return undefined;
    }
    const style = getWeaponStyle(getWeapon(weaponId));
    const share = getRaidBossShare(sim.map, style, sim.expert);
    if (share === undefined) {
        return undefined;
    }
    // Nylocas Vasilias takes her colour's style better, so it's most of the Theatre's bosses
    const bosses = raidHasColours(sim.map) ? "most bosses" : "bosses";
    return `-${Math.round((1 - share) * 100)}% damage to ${bosses}: they pray against ${style}`;
}

function getChoiceViews(sim: Sim): ChoiceView[] {
    const style = getCharacter(sim.characterId).style;
    return sim.choices.map((choice, index) => {
        const { title, text, iconObjId, iconSpriteId, quality, stats } = describeChoice(choice);
        const rarity = quality ? RARITIES[quality] : undefined;
        return {
            title,
            text,
            iconObjId,
            iconSpriteId,
            isNew: choice.kind === "newWeapon" || choice.kind === "newPassive",
            isEvolution: choice.kind === "evolve",
            isHilt: choice.kind === "hilt",
            isSpell: choice.kind === "hilt" && getWeapon(choice.into).family === "ancient_burst",
            rarity: rarity && { name: rarity.name, color: rarity.color },
            stats,
            evolves: getEvolutionHint(choice, sim.weapons, sim.passives, style, sim.unlockedItems),
            banishable: sim.canBanishChoice(index),
            banished: sim.isBanishedChoice(index),
            lockable: sim.canLockChoice(index),
            locked: sim.isLockedChoice(index),
            carried: sim.isCarriedChoice(index),
            bossPenalty: getBossPenalty(sim, choice),
        };
    });
}

// What a co-op player brings, as far as any game could have it (another
// player's game could send anything)
function cleanLoadout(loadout: Loadout | undefined): {
    unlockedItems: Set<string>;
    armoury: Record<string, number>;
} {
    const items = Array.isArray(loadout?.unlockedItems) ? loadout.unlockedItems : [];
    const armoury: Record<string, number> = {};
    for (const [id, times] of Object.entries(loadout?.armoury ?? {})) {
        if (Number.isInteger(times) && times > 0) {
            armoury[id] = Math.min(times, 20);
        }
    }
    return {
        unlockedItems: new Set(items.filter((id) => typeof id === "string").slice(0, 5000)),
        armoury,
    };
}

// What a co-op player's loadout gives their hero, no more than the shop can
export function loadoutStats(loadout: Loadout | undefined): Stats {
    const stats = emptyStats();
    for (const [key, value] of Object.entries(loadout?.metaStats ?? {})) {
        // A stat's own name only: "constructor" is in every object
        if (Object.hasOwn(stats, key) && typeof value === "number" && Number.isFinite(value)) {
            const most = SHOP_MAX[key as keyof Stats] ?? 0;
            stats[key as keyof Stats] = Math.max(Math.min(0, most), Math.min(most, value));
        }
    }
    return stats;
}

// Each stat with every shop upgrade for it bought (no prototype, so nothing
// inherited reads as a stat)
const SHOP_MAX: Partial<Stats> = Object.create(null);
for (const upgrade of SHOP_UPGRADES) {
    SHOP_MAX[upgrade.stat] = (SHOP_MAX[upgrade.stat] ?? 0) + upgrade.perRank * upgrade.maxRank;
}

// Why a co-op run ended early, on its results
const ENDED_EARLY: Partial<Record<GoneReason, string>> = {
    idle: "The room closed after half an hour with nothing happening.",
    kicked: "The host removed you from the party.",
    disbanded: "The host disbanded the party.",
    hostLeft: "The host left, so the run's over.",
};

export type GameClientOptions = {
    // Extra goblins at the start of a run, for performance testing
    stress: number;
    // Start a run with this character straight away (testing)
    autostart?: string;
    // ?raidtest on the dev server: solo runs with a raid's rooms two minutes apart and every
    // level up at its max (SimTesting); "short" for the rooms alone
    raidTest?: "max" | "short";
};

// A boss winding up a gaze (BossAttackDef.cover) lights the arena, more as it comes: how much
// brighter than the map's own, from 1 to 1 + GAZE_LIGHT as it lands
export function getGazeLight(sim: Sim): number {
    const boss = sim.shownBoss;
    const windup = boss && !boss.dead ? boss.bossState?.windup : undefined;
    if (!windup?.attack.cover) {
        return 1;
    }
    const raw = (sim.tick - windup.startTick) / Math.max(1, windup.landTick - windup.startTick);
    const t = Math.min(1, Math.max(0, raw));
    return 1 + GAZE_LIGHT * t * t * (3 - 2 * t);
}

// What a fight on its hitpoints shows on its bar: all of them, or with BossPhasesDef.barPerPhase
// the phase's own share, full as it begins and empty at the next threshold (each phase's until,
// or an even split, as Sim.passThreshold has them)
export function getPhaseBarFraction(boss: Enemy, index: number): number {
    const phases = boss.def.boss?.phases;
    if (!phases?.barPerPhase) {
        return boss.hp / boss.maxHp;
    }
    const count = phases.phases.length;
    const until = (i: number) =>
        i < 0 ? 1 : i >= count - 1 ? 0 : (phases.phases[i].until ?? (count - 1 - i) / count);
    const top = until(index - 1) * boss.maxHp;
    const bottom = until(index) * boss.maxHp;
    return Math.min(1, Math.max(0, (boss.hp - bottom) / Math.max(1, top - bottom)));
}

export class GameClient implements GameFrameHandler {
    static async create(
        mapViewer: MapViewer,
        renderer: GameWebGLRenderer,
        overlayCanvas: HTMLCanvasElement,
        store: GameStore,
        saveStore: SaveStore,
        saveLock: SaveLock,
        options: GameClientOptions,
    ): Promise<GameClient> {
        // Before the first map squares load, so they're only what the title screen needs
        setPlayArea(renderer, getArenaRegion(TITLE_MAP), false);
        const workerPool = mapViewer.workerPool;
        const regionPromise = workerPool.queueLoad<RegionDataInput, RegionData, RegionDataLoader>(
            new RegionDataLoader(),
            getArenaRegion(TITLE_MAP),
        );

        const audio = new GameAudio();
        const soundsPromise = audio.load(workerPool, getGameSoundIds());

        const actors = await renderer.getActorRenderer();
        const assets = new GameAssets(workerPool, renderer, actors);
        const spritesPromise = assets.loadSprites();
        store.set({ loadingText: "Summoning monsters", loadingProgress: 10 });
        await assets.loadBase((done, total) => {
            store.set({ loadingProgress: 10 + Math.round((done / total) * 70) });
        });
        store.set({ loadingText: "Dressing up", loadingProgress: 85 });
        await assets.setCharacterLook(store.getSnapshot().characterId);
        store.set({ loadingText: `Building ${TITLE_MAP.name}`, loadingProgress: 95 });
        const grid = new ArenaGrid(await regionPromise);
        await soundsPromise;
        await spritesPromise;

        return new GameClient(
            mapViewer,
            renderer,
            grid,
            assets,
            audio,
            overlayCanvas,
            store,
            saveStore,
            saveLock,
            options,
        );
    }

    readonly input: GameInput;
    readonly overlay: Overlay;
    readonly view: GameView;
    readonly minimap: Minimap;
    readonly sounds: GameSounds;
    readonly cameraRig = new CameraRig();

    sim?: Sim;
    paused = false;
    save: SaveData;
    // The save was written by a newer version of the game, so it's not saved
    // over (unless the player says so, see saveOverNewer)
    private newerSave?: NewerSave;
    // The save couldn't be read and there was no room to keep a copy, so it
    // stays as it is
    private saveNoRoom = false;
    private stopSaveLock?: () => void;
    // Co-op: the room and its relay, and the run being played with it
    readonly coop: CoopLobby;
    private coopRun?: CoopRun;
    private reportRun?: ReturnType<typeof startRunAnalytics>;
    // The hero the camera follows: this player's, or in co-op while they're
    // down, a teammate's
    private viewHero = 0;
    // What the run's waiting on, last shown (co-op choices come in frames)
    private decisionKey = "";

    private accumulator = 0;
    private lastHudUpdate = 0;
    // Co-op: the living boss on the boss bar (getCoopBarBoss)
    private coopBarBoss: Enemy | undefined;
    // Where the camera thinks the ground is, on a dev map
    private cameraGround: number | undefined;
    // How far the camera's leaning towards a boss that asks for it (BOSS_LEAN)
    private cameraLean = { x: 0, y: 0 };
    // Where a raid boss's head was on the screen (getRaidRoomLean), and the boss bar's bottom
    private readonly leanPoint: ScreenPoint = { x: 0, y: 0, visible: false };
    private bossBarBottom?: { y: number; at: number };
    // How far north of the player last frame's camera was, all told (its lean and any shake)
    private cameraOffsetY = 0;
    // How lit a gaze has the arena now (getGazeLight, eased)
    private gazeLight = 1;
    // The camera's shake: how hard (0 to 1), and since when (ms)
    private shake = { strength: 0, start: 0 };
    private shownDps = 0;
    // The world's brightness as last set: a raid hall can draw darker than its map
    private shownBrightness = 1;
    // The raid hall's colour wash as last set (RaidRoomDef.hall)
    private shownWash: string | undefined;
    private shownDpsTick = 0;
    private readonly damageMeter = new DamageMeter();
    // Each hero's look, as last baked
    private appearanceVersions: number[] = [];
    // Each hero's level-up choices their look was last baked for
    private lookChoices: (UpgradeChoice[] | undefined)[] = [];
    // The casket Auto alch or Auto equip answered, until that's done (co-op's
    // comes back with a frame: it shouldn't go twice, or show the casket
    // meanwhile)
    private autoChest?: { uid: number; action: ChestAction };
    private runRecorded = false;
    // Adventurers this run has done the task for, already told about
    private tasksAnnounced = new Set<string>();
    private attractTick = 0;
    private attractYaw = 0;
    private display = loadDisplaySettings();
    private readonly move = { x: 0, y: 0 };
    private readonly screen: ScreenPoint = { x: 0, y: 0, visible: false };
    private fps = 60;
    // The HUD's minimap, while it's on screen
    private minimapCanvas?: HTMLCanvasElement;
    // Collision for each map, built the first time a run goes there
    private readonly grids = new Map<string, ArenaGrid>();
    // The current map's: the run's, or the title screen's
    grid: ArenaGrid;

    constructor(
        readonly mapViewer: MapViewer,
        readonly renderer: GameWebGLRenderer,
        titleGrid: ArenaGrid,
        readonly assets: GameAssets,
        readonly audio: GameAudio,
        overlayCanvas: HTMLCanvasElement,
        readonly store: GameStore,
        readonly saveStore: SaveStore,
        readonly saveLock: SaveLock,
        readonly options: GameClientOptions,
    ) {
        this.save = store.getSnapshot().save;
        this.grid = titleGrid;
        this.grids.set(TITLE_MAP.id, titleGrid);
        this.sounds = new GameSounds(audio);
        store.set({ audio: audio.settings, display: this.display });
        this.view = new GameView(assets);
        this.minimap = new Minimap(mapViewer);
        this.overlay = new Overlay(overlayCanvas);
        this.input = new GameInput(renderer.canvas);
        this.input.onPress = this.onKeyPress;
        this.input.takesKey = (code) => code === "Tab" && this.isPlaying();
        this.input.pads.onConnect = (pad) =>
            this.store.toast(
                pad.standard
                    ? `${pad.name} connected.`
                    : `${pad.name} connected. Its buttons aren't on a layout the browser knows, so only its stick works.`,
                pad.standard ? 3000 : 7000,
            );
        // A controller going flat mid-run pauses it, as leaving the window does
        this.input.pads.onDisconnect = (pad) => {
            this.store.toast(`${pad.name} disconnected.`, 4000);
            if (this.sim && !this.coopRun && this.store.getSnapshot().overlay === "none") {
                this.pause();
            }
        };
        this.input.onBlur = () => {
            this.accumulator = 0;
            // With auto-pause off the run carries on (though a hidden tab
            // stops drawing, so it waits there until it's back). Co-op never
            // pauses for one player.
            if (
                this.sim &&
                !this.coopRun &&
                this.display.pauseOnBlur &&
                this.store.getSnapshot().overlay === "none"
            ) {
                this.pause();
            }
        };
        this.coop = new CoopLobby(store);
        this.coop.onStart = (game) => this.beginCoopRun(game);
        this.coop.onUp = (from, message) => this.toCoopRun((run) => run.receiveUp(from, message));
        this.coop.onDown = (message) => this.toCoopRun((run) => run.receiveDown(message));
        this.coop.onLeft = (id) => this.toCoopRun((run) => run.playerLeft(id));
        this.coop.onGone = (reason) => this.onCoopGone(reason);
        this.coop.onClosed = () => this.onCoopClosed();
        this.coop.onReconnecting = () => {
            if (this.coopRun) {
                this.store.toast("Connection dropped. Reconnecting...", 4000);
            }
        };
        this.coop.onResumed = () => {
            if (this.coopRun) {
                this.store.toast("Reconnected.", 2000);
            }
            this.toCoopRun((run) => run.resumed());
        };
        this.coop.onMapChanged = () => this.coop.setMe({ loadout: this.getLoadout() });
        // Co-op's offered only where there's a relay to play it through
        this.coop.checkAvailable();
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.cameraRig.pitch = ATTRACT_PITCH;
        this.cameraRig.distance = ATTRACT_DISTANCE;
        // Before a run starts, so it's with the save as it is now
        this.stopSaveLock = this.saveLock.listen((held) => this.onSaveLock(held));

        // An invite link (?room=CODE) goes straight to the room
        const invite = new URLSearchParams(window.location.search).get("room");
        if (options.autostart) {
            this.store.set({ characterId: options.autostart });
            this.startRun();
        } else if (invite) {
            this.openCoop().then(() => this.joinRoom(invite));
        } else {
            this.showScreen("title");
        }
    }

    setMinimapCanvas(canvas: HTMLCanvasElement | null): void {
        this.minimapCanvas = canvas ?? undefined;
    }

    dispose(): void {
        this.stopSaveLock?.();
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.stopBackgroundTicker();
        this.coop.close();
        this.input.dispose();
        this.audio.dispose();
        if (this.renderer.game === this) {
            this.renderer.game = undefined;
        }
    }

    // ---- UI actions ----

    showScreen(screen: Screen): void {
        this.store.set({ screen });
    }

    // The adventurer the game starts on (or none, to start on the first again)
    toggleFavouriteCharacter(characterId: string): void {
        if (!this.save.unlockedCharacters.includes(characterId)) {
            return;
        }
        this.save.favouriteCharacter =
            this.save.favouriteCharacter === characterId ? undefined : characterId;
        this.persist();
    }

    selectCharacter(characterId: string): void {
        if (!this.save.unlockedCharacters.includes(characterId)) {
            return;
        }
        this.store.set({ characterId });
        if (!this.sim) {
            this.assets.setCharacterLook(characterId);
        }
        this.coop.setMe({ characterId, loadout: this.getLoadout() });
    }

    // The pet to take along (one of the trophies found), or none
    selectPet(petId: string | undefined): void {
        if (petId !== undefined && !isPetFound(this.save.trophies, petId)) {
            return;
        }
        this.save.pet = petId;
        this.persist();
        this.coop.setMe({ loadout: this.getLoadout() });
    }

    // The map for the next run. Hosting a room, it's the room's map: the relay
    // says it back in a room update, which the lobby shows, so nothing's
    // changed here until it has. Endless and hard mode stay on where everyone
    // has them for the new map, as the relay insists.
    selectMap(mapId: string): void {
        if (!isMapUnlocked(this.save, mapId)) {
            return;
        }
        const room = this.hostedRoom();
        if (room) {
            this.coop.setMap(
                mapId,
                room.endless && this.roomHas("endless", mapId),
                room.hard && this.roomHas("hard", mapId),
            );
            return;
        }
        const snapshot = this.store.getSnapshot();
        this.store.set({
            mapId,
            endless: snapshot.endless && isEndlessUnlocked(this.save, mapId),
            hard: snapshot.hard && isHardUnlocked(this.save, mapId),
            expert: snapshot.expert && isExpertUnlocked(this.save, mapId),
        });
    }

    // Endless runs, for a map that's been beaten (the room's, hosting one)
    toggleEndless(): void {
        const room = this.hostedRoom();
        if (room) {
            if (room.endless || this.roomHas("endless", room.mapId)) {
                this.coop.setMap(room.mapId, !room.endless, room.hard);
            }
            return;
        }
        const { mapId, endless } = this.store.getSnapshot();
        if (endless || isEndlessUnlocked(this.save, mapId)) {
            this.store.set({ endless: !endless });
        }
    }

    // Hard mode, for a map that's been beaten (the room's, hosting one)
    toggleHard(): void {
        const room = this.hostedRoom();
        if (room) {
            if (room.hard || this.roomHas("hard", room.mapId)) {
                this.coop.setMap(room.mapId, room.endless, !room.hard);
            }
            return;
        }
        const { mapId, hard } = this.store.getSnapshot();
        if (hard || isHardUnlocked(this.save, mapId)) {
            // Expert is hard mode too: off with it
            this.store.set(hard ? { hard: false, expert: false } : { hard: true });
        }
    }

    // A raid's expert mode, once it's been beaten on hard. Solo only for now: co-op's rooms
    // don't carry it.
    toggleExpert(): void {
        const { mapId, expert, hard } = this.store.getSnapshot();
        if (expert || isExpertUnlocked(this.save, mapId)) {
            // Expert's hard mode too
            this.store.set({ expert: !expert, hard: !expert || hard });
        }
    }

    // The room this player hosts, whose map and modes are the relay's to
    // change
    private hostedRoom(): RoomView | undefined {
        return this.coop.isHost ? this.coop.room : undefined;
    }

    // Whether a map's endless or hard mode can be on in the room: this player
    // has it, and so does everyone else (unless the relay takes anyone), as
    // the relay checks before it takes a setting
    private roomHas(mode: "endless" | "hard", mapId: string): boolean {
        const mine =
            mode === "endless"
                ? isEndlessUnlocked(this.save, mapId)
                : isHardUnlocked(this.save, mapId);
        const { room, anyMap } = this.store.getSnapshot().coop;
        return (
            mine &&
            (anyMap ||
                !room ||
                room.members.every((member) => member.unlocks?.[mode]?.includes(mapId) === true))
        );
    }

    // ---- Co-op menus ----

    // The co-op screen, connected to the relay
    async openCoop(): Promise<void> {
        this.showScreen("coop");
        this.coop.setMe({
            characterId: this.store.getSnapshot().characterId,
            loadout: this.getLoadout(),
            unlocks: this.getUnlocks(),
            hideCountry: !this.display.coopFlag,
        });
        await this.coop.connect();
    }

    // Back to the title, out of any room
    closeCoop(): void {
        if (this.coop.room) {
            this.coop.leave();
        }
        this.coop.close();
        this.showScreen("title");
    }

    // Another name from the relay
    renameCoop(): void {
        this.coop.rename();
    }

    // A room of this player's, for the map picked
    createRoom(open: boolean): void {
        const { mapId, endless, hard } = this.store.getSnapshot();
        this.coop.create(open, mapId, endless, hard);
    }

    // Another page of the open rooms
    showRoomsPage(page: number): void {
        this.coop.showPage(page);
    }

    joinRoom(code: string): void {
        this.coop.join(code);
    }

    leaveRoom(): void {
        this.coop.leave();
    }

    setCoopReady(ready: boolean): void {
        this.coop.setReady(ready);
    }

    setRoomOpen(open: boolean): void {
        this.coop.setOpen(open);
    }

    kickPlayer(id: string): void {
        this.coop.kick(id);
    }

    disbandRoom(): void {
        this.coop.disband();
    }

    // The invite link for the room, for its code
    getInviteLink(code: string): string {
        const url = new URL(window.location.href);
        url.search = "";
        url.searchParams.set("room", code);
        return url.toString();
    }

    // The maps this player has, and has endless and hard mode for, which rooms
    // go by
    private getUnlocks(): Unlocks {
        const ids = [...MAPS, ...RAID_MAPS, ...FUN_MAPS].map((m) => m.id);
        return {
            maps: ids.filter((id) => isMapUnlocked(this.save, id)),
            endless: ids.filter((id) => isEndlessUnlocked(this.save, id)),
            hard: ids.filter((id) => isHardUnlocked(this.save, id)),
        };
    }

    private getLoadout(): Loadout {
        const characterId =
            (this.coop.room && getMap(this.coop.room.mapId).fun?.character) ??
            this.store.getSnapshot().characterId;
        return makeLoadout(
            getMetaStats(this.save, getCharacter(characterId).style),
            [...this.save.unlockedItems],
            {
                ...this.save.armoury,
            },
            this.save.pet,
        );
    }

    // The host's Start: everyone's ready, so off to the room's map. The relay
    // sends the start back to everyone (this player too), and the run begins
    // there.
    startCoopRun(): void {
        const room = this.coop.room;
        if (!room || !this.coop.isHost) {
            return;
        }
        // Everyone's ready, the host too (on their own, that's a party of one)
        if (room.members.some((m) => !m.ready) || room.members.length > MAX_PARTY) {
            this.sounds.denied();
            return;
        }
        const map = getMap(room.mapId);
        if (!isMapUnlocked(this.save, map.id)) {
            this.sounds.denied();
            return;
        }
        // The room's modes, which the relay checked everyone has (or takes
        // anyone for, with anyMap), so the run is what the lobby said
        const { anyMap } = this.store.getSnapshot().coop;
        const game: GameStart = {
            seed: (Math.random() * 0x7fffffff) | 0,
            mapId: map.id,
            endless:
                map.fun !== undefined ||
                (room.endless && (anyMap || isEndlessUnlocked(this.save, map.id))),
            hard: room.hard === true && (anyMap || isHardUnlocked(this.save, map.id)),
            heroes: room.members.map((member) => ({
                id: member.id,
                name: member.name,
                characterId:
                    getMapCharacter(map) ??
                    (CHARACTERS.some((c) => c.id === member.characterId)
                        ? member.characterId
                        : CHARACTERS[0].id),
                loadout: member.loadout ?? makeLoadout({}, [], {}),
            })),
        };
        this.coop.start(game);
    }

    // Kicked or disbanded, or the host left: a run that was going ends
    private onCoopGone(reason: GoneReason): void {
        if (reason !== "left") {
            this.store.toast(ENDED_EARLY[reason] ?? "You left the party.", 5000);
        }
        // A run that's still loading never starts
        this.coopInbox = undefined;
        if (this.coopRun && this.sim && !this.sim.runOver) {
            this.endCoopRunEarly(ENDED_EARLY[reason] ?? "You left the party.");
        }
    }

    private onCoopClosed(): void {
        // A run that's still loading never starts
        this.coopInbox = undefined;
        const sim = this.sim;
        const run = this.coopRun;
        if (!sim || !run || sim.runOver) {
            return;
        }
        if (run.isHost) {
            // The run's this copy's: it goes on without the others
            for (const hero of sim.heroes) {
                if (hero.index !== sim.focus) {
                    sim.leave(hero.index);
                }
            }
            this.coopRun = undefined;
            // Solo now: a hidden tab no longer needs stepping
            this.stopBackgroundTicker();
            this.store.toast(
                "Lost the connection to the others. The run goes on without them.",
                6000,
            );
        } else {
            this.endCoopRunEarly("Lost the connection to the co-op server.");
        }
    }

    // A guest's run that can't go on: what was done counts, as if they'd quit
    private endCoopRunEarly(why: string): void {
        // Nothing more of it is stepped, frames still to come included
        this.coopStopped = true;
        this.stopBackgroundTicker();
        this.finishRun(why);
        this.store.set({ overlay: "dead", choices: [], chest: undefined, waitingOn: [] });
        this.updateHud(true);
    }

    buyUpgrade(upgradeId: string, style: CombatStyle = "melee"): void {
        if (buyUpgrade(this.save, upgradeId, style)) {
            this.sounds.buy();
            this.persist();
        } else {
            this.sounds.denied();
        }
    }

    // Upgrades a piece of gear in the Armoury, one step
    upgradeGear(itemId: string): void {
        if (buyArmouryUpgrade(this.save, itemId)) {
            this.sounds.buy();
            this.persist();
        } else {
            this.sounds.denied();
        }
    }

    playClick(): void {
        this.sounds.click();
    }

    setVolume(volume: number): void {
        this.audio.setSettings({ volume, muted: false });
        this.store.set({ audio: this.audio.settings });
    }

    setMusicVolume(music: number): void {
        this.audio.setSettings({ music, muted: false });
        this.store.set({ audio: this.audio.settings });
    }

    toggleMute(): void {
        this.audio.setSettings({ muted: !this.audio.settings.muted });
        this.store.set({ audio: this.audio.settings });
    }

    toggleMenuSpin(): void {
        this.setDisplay({ menuSpin: !this.display.menuSpin });
    }

    toggleScreenShake(): void {
        this.setDisplay({ screenShake: !this.display.screenShake });
    }

    togglePickupTimers(): void {
        this.setDisplay({ pickupTimers: !this.display.pickupTimers });
    }

    toggleAutoPause(): void {
        this.setDisplay({ pauseOnBlur: !this.display.pauseOnBlur });
    }

    toggleAutoAlch(): void {
        this.setDisplay({ autoAlch: !this.display.autoAlch });
    }

    toggleAutoEquip(): void {
        this.setDisplay({ autoEquip: !this.display.autoEquip });
    }

    // Takes hold for the run being played too: its report is only sent at the end
    toggleRunStats(): void {
        this.setDisplay({ runStats: !this.display.runStats });
    }

    toggleQuestTracker(): void {
        this.setDisplay({ questTracker: !this.display.questTracker });
    }

    // In a run with nothing over it: Tab is the damage panel's then, and the
    // browser's (moving between buttons) on every other screen
    private isPlaying(): boolean {
        return (
            this.sim !== undefined &&
            !this.sim.runOver &&
            this.store.getSnapshot().overlay === "none"
        );
    }

    toggleDamagePanel(): void {
        this.setDisplay({ damagePanel: !this.display.damagePanel });
    }

    toggleMovePrediction(): void {
        this.setDisplay({ movePrediction: !this.display.movePrediction });
        this.coopRun?.setPrediction(this.display.movePrediction);
    }

    // The room hears at once, and the rooms list from the next update. An open
    // room's host shows theirs either way (the relays' shownCountry).
    toggleCoopFlag(): void {
        this.setDisplay({ coopFlag: !this.display.coopFlag });
        this.coop.setMe({ hideCountry: !this.display.coopFlag });
    }

    // Takes hold from the next frame (update)
    setFrameRate(frameRate: FrameRate): void {
        this.setDisplay({ frameRate });
    }

    private setDisplay(changes: Partial<DisplaySettings>): void {
        this.display = { ...this.display, ...changes };
        saveDisplaySettings(this.display);
        this.store.set({ display: this.display });
    }

    refundUpgrade(upgradeId: string, style: CombatStyle = "melee"): void {
        if (refundUpgrade(this.save, upgradeId, style)) {
            this.persist();
        }
    }

    refundUpgrades(style: CombatStyle = "melee"): void {
        refundUpgrades(this.save, style);
        this.persist();
    }

    // Gives the player the save as a file. One from a newer game goes as it
    // is: this game's copy has dropped what it doesn't know. This game's copy
    // says when it was made, and once the file's kept the save remembers it,
    // so the title's reminder goes till tomorrow.
    exportSave(): void {
        const exported = Date.now();
        const text =
            (this.newerSave && this.saveStore.read()) ??
            exportSave({ ...this.save, lastExported: exported }, this.saveStore.gameVersion);
        saveFile("run-escape-save.json", text, "application/json", () => {
            this.save.lastExported = exported;
            this.persist();
        });
    }

    // Gives the player a save that couldn't be read, as it was
    exportUnreadableSave(key: string): void {
        const text = this.saveStore.readUnreadable(key);
        if (text !== undefined) {
            saveFile("run-escape-save-unreadable.json", text, "application/json");
        }
    }

    deleteUnreadableSave(key: string): void {
        this.saveStore.deleteUnreadable(key);
        this.store.set({ unreadableSaves: this.saveStore.getUnreadable() });
    }

    closeUnreadableNotice(): void {
        this.store.set({ unreadableSave: undefined });
    }

    // Saves here, and the tab that was saving stops
    takeOverSave(): void {
        this.saveLock.takeOver();
    }

    // Saves over the newer game's save from here on, losing what's new in it.
    // The player's choice (and the only way out when a release is rolled
    // back), but not for a newer format, which this game can't read.
    saveOverNewer(): void {
        if (!this.newerSave || this.newerSave.format) {
            return;
        }
        this.newerSave = undefined;
        this.saveStore.writeOver();
        this.persist();
        this.updateSaveBlock();
    }

    playWithoutSaving(): void {
        this.store.set({ saveBlockClosed: true });
    }

    showSaveBlock(): void {
        this.store.set({ saveBlockClosed: false });
    }

    private onSaveLock(held: boolean): void {
        if (held) {
            this.reloadSave();
        } else {
            this.updateSaveBlock();
        }
    }

    // Reads the save again, as the tab that had it last left it
    private reloadSave(): void {
        const loaded = this.saveStore.load();
        this.newerSave = loaded.newer;
        this.saveNoRoom = loaded.noRoom === true;
        this.useSave(loaded.save);
        this.store.set({
            // With no room for a copy, the panel saying so is the notice
            unreadableSave: loaded.noRoom ? undefined : loaded.unreadable,
            unreadableSaves: this.saveStore.getUnreadable(),
        });
        this.updateSaveBlock();
        if (loaded.unreadable) {
            // It's kept, so the fresh save can go in its place
            this.persist();
        } else {
            this.store.set({ save: structuredClone(this.save) });
        }
    }

    private updateSaveBlock(): void {
        let saveBlock: SaveBlock | undefined;
        if (this.saveLock.held === false) {
            saveBlock = { kind: "otherTab" };
        } else if (this.newerSave) {
            saveBlock = { kind: "newerGame", ...this.newerSave };
        } else if (this.saveNoRoom) {
            saveBlock = { kind: "noRoom" };
        }
        // A new reason shows the panel again, and stops a solo run for it
        // (co-op's goes on for the others)
        const { saveBlock: was, saveBlockClosed } = this.store.getSnapshot();
        const changed = saveBlock?.kind !== was?.kind;
        this.store.set({ saveBlock, saveBlockClosed: saveBlockClosed && !changed });
        if (saveBlock && changed && !this.coopRun) {
            this.pause();
        }
    }

    // Swaps in an imported save in place of this one
    replaceSave(save: SaveData): void {
        this.useSave(save, true);
        this.persist();
    }

    // Plays on with this save. toFavourite: go to its favourite, as it would
    // start on, if it has one that's open (an import; a save given back by
    // another tab leaves the pick alone)
    private useSave(save: SaveData, toFavourite = false): void {
        this.save = save;
        // The adventurer and map picked might not be open in it
        const { characterId, mapId } = this.store.getSnapshot();
        const starting = getStartingCharacter(save);
        const favourite = toFavourite && starting === save.favouriteCharacter;
        if (
            characterId !== starting &&
            (favourite || !save.unlockedCharacters.includes(characterId))
        ) {
            this.selectCharacter(starting);
        }
        if (!isMapUnlocked(save, mapId)) {
            this.store.set({ mapId: MAPS[0].id });
        }
        if (!isEndlessUnlocked(save, this.store.getSnapshot().mapId)) {
            this.store.set({ endless: false });
        }
        if (!isHardUnlocked(save, this.store.getSnapshot().mapId)) {
            this.store.set({ hard: false });
        }
    }

    private persist(): void {
        // Played without saving, it carries on in memory
        if (this.saveLock.held && !this.newerSave && !this.saveNoRoom) {
            this.saveStore.save(this.save);
        }
        // A fresh object so React sees the change
        this.store.set({ save: structuredClone(this.save) });
    }

    // Builds a map's collision the first time it's played (a scene build of
    // the whole arena, a moment's work)
    private async loadGrid(mapId: string): Promise<ArenaGrid> {
        let grid = this.grids.get(mapId);
        if (!grid) {
            await installRecipe(this.mapViewer, mapId);
            const region = await this.mapViewer.workerPool.queueLoad<
                RegionDataInput,
                RegionData,
                RegionDataLoader
            >(new RegionDataLoader(), getArenaRegion(getMap(mapId)));
            grid = new ArenaGrid(region);
            // Only the title screen's and this map's are kept: a phone needn't
            // hold every map played
            for (const id of this.grids.keys()) {
                if (id !== TITLE_MAP.id) {
                    this.grids.delete(id);
                }
            }
            this.grids.set(mapId, grid);
        }
        return grid;
    }

    // Forgets a map's collision, for a map that's changed
    forgetGrid(mapId: string): void {
        this.grids.delete(mapId);
    }

    // Loads a map's collision and enemies for a run, and the party's pets, with
    // the loading screen if it takes a moment. False if it couldn't.
    private async travelTo(
        mapId: string,
        back: Screen,
        pets: (string | undefined)[],
    ): Promise<boolean> {
        const map = getMap(mapId);
        const enemies = getMapEnemies(map);
        if (!this.grids.has(mapId) || !this.assets.hasEnemies(enemies)) {
            this.store.set({
                screen: "loading",
                loadingText: `Travelling to ${map.name}`,
                loadingProgress: 25,
            });
        }
        // A pet that won't bake isn't a reason to stay: loadPets doesn't fail
        const petsBaked = this.assets.loadPets(pets);
        try {
            this.grid = await this.loadGrid(mapId);
            await this.assets.loadEnemies(enemies, (done, total) => {
                this.store.set({ loadingProgress: 25 + Math.round((done / total) * 75) });
            });
            await petsBaked;
            return true;
        } catch (e) {
            console.error("Failed to load map", mapId, e);
            this.store.set({ screen: back });
            this.store.toast(`Couldn't get to ${map.name}.`);
            return false;
        }
    }

    async startRun(mapId: string = this.store.getSnapshot().mapId): Promise<void> {
        if (!isMapUnlocked(this.save, mapId)) {
            return;
        }
        const map = getMap(mapId);
        // Fun maps are always endless, and some have everyone play one
        // adventurer (Durial321 in Falador)
        const endless =
            map.fun !== undefined ||
            (this.store.getSnapshot().endless && isEndlessUnlocked(this.save, mapId));
        const hard = this.store.getSnapshot().hard && isHardUnlocked(this.save, mapId);
        const expert = this.store.getSnapshot().expert && isExpertUnlocked(this.save, mapId);
        const characterId = getMapCharacter(map) ?? this.store.getSnapshot().characterId;
        if (!(await this.travelTo(mapId, "characters", [this.save.pet]))) {
            return;
        }
        usePortableMath(false);
        const sim = new Sim({
            grid: this.grid,
            mapId,
            characterId,
            metaStats: getMetaStats(this.save, getCharacter(characterId).style),
            seed: (Math.random() * 0x7fffffff) | 0,
            spawnX: map.spawn.x,
            spawnY: map.spawn.y,
            unlockedItems: new Set(this.save.unlockedItems),
            endless,
            hard,
            expert,
            raidTeleports: RAID_TELEPORTS,
            raidPortals: getRaidPortals(this.save, mapId),
            armoury: { ...this.save.armoury },
            testing: this.options.raidTest
                ? { raidRoomSeconds: 120, maxLevelUps: this.options.raidTest === "max" }
                : undefined,
        });
        for (let i = 0; i < this.options.stress; i++) {
            sim.spawnEnemy(getEnemy("goblin"), "normal");
        }
        this.enterRun(sim, [this.save.pet]);
    }

    // A message for the co-op run, kept while its copy is still being made
    // (the map loading, which can take one player longer than the rest) and
    // handed over once it's there
    private toCoopRun(deliver: (run: CoopRun) => void): void {
        if (this.coopRun) {
            deliver(this.coopRun);
        } else if (this.coopInbox && this.coopInbox.length < MAX_COOP_INBOX) {
            this.coopInbox.push(deliver);
        }
    }

    // A co-op run, as the host started it: everyone builds the same Sim, each
    // playing their own hero
    private async beginCoopRun(game: GameStart): Promise<void> {
        if (!isGameStart(game, MAX_PARTY)) {
            this.store.toast("That run needs a map or adventurer your game doesn't have.", 6000);
            this.coopInbox = undefined;
            this.coop.leave();
            return;
        }
        const you = this.coop.id;
        const focus = game.heroes.findIndex((hero) => hero.id === you);
        const room = this.coop.room;
        if (focus === -1 || !room) {
            return;
        }
        this.coopInbox = [];
        // A map or adventurer this game hasn't got (another player's game
        // could be newer, or made up): it can't play along
        if (
            !MAP_BY_ID.has(game.mapId) ||
            !game.heroes.every((hero) => CHARACTERS.some((c) => c.id === hero.characterId))
        ) {
            this.store.toast("That run needs a map or adventurer your game doesn't have.", 6000);
            this.coopInbox = undefined;
            this.coop.leave();
            return;
        }
        if (this.sim) {
            // Still on the last run's results
            this.leaveRun(false);
        }
        // Each hero's pet, only for looks (another player's game could send anything)
        const pets = game.heroes.map((hero) =>
            typeof hero.loadout?.pet === "string" ? hero.loadout.pet : undefined,
        );
        if (!(await this.travelTo(game.mapId, "coop", pets))) {
            this.coopInbox = undefined;
            this.coop.leave();
            return;
        }
        // The room went while the map loaded (the host left, the connection
        // dropped): there's no run to join
        if (!this.coopInbox || this.coop.room?.code !== room.code) {
            this.coopInbox = undefined;
            this.store.set({ screen: this.coop.room ? "coop" : "title" });
            return;
        }
        // Every copy has to work out the same numbers, to the bit
        usePortableMath(true);
        const map = getMap(game.mapId);
        const party: HeroOptions[] = game.heroes.map((hero) => ({
            name: hero.name,
            characterId: hero.characterId,
            metaStats: loadoutStats(hero.loadout),
            ...cleanLoadout(hero.loadout),
        }));
        const sim = new Sim({
            grid: this.grid,
            mapId: game.mapId,
            characterId: party[focus].characterId,
            metaStats: party[focus].metaStats,
            seed: game.seed,
            spawnX: map.spawn.x,
            spawnY: map.spawn.y,
            endless: game.endless,
            hard: game.hard,
            party,
            focus,
        });
        const heroes = new Map(game.heroes.map((hero, i) => [hero.id, i]));
        const run = new CoopRun(sim, this.coop.isHost, this.coop, heroes, room.hostId);
        run.setPrediction(this.display.movePrediction);
        this.coopRun = run;
        this.coopPlayerIds = game.heroes.map((hero) => hero.id);
        const inbox = this.coopInbox ?? [];
        this.coopInbox = undefined;
        for (const deliver of inbox) {
            deliver(run);
        }
        this.enterRun(sim, pets);
        if (!this.coop.isHost) {
            this.coop.sendUp({ loaded: true });
        }
        // Hidden while it loaded: it keeps up from the start
        if (document.hidden) {
            this.onVisibilityChange();
        }
    }

    // pets: each hero's pet, in the party's order
    private enterRun(sim: Sim, pets: (string | undefined)[]): void {
        const map = sim.map;
        this.sim = sim;
        this.renderer.setPlane(this.grid.plane);
        this.renderer.setSmoothTerrain(map.scaperune === true);
        this.grid.exactGround = map.scaperune === true;
        this.cameraGround = undefined;
        this.cameraLean = { x: 0, y: 0 };
        this.renderer.setBrightness(map.brightness ?? 1);
        this.shownBrightness = map.brightness ?? 1;
        this.renderer.setWash(undefined);
        this.shownWash = undefined;
        this.minimap.setMap(map);
        const music = map.music && musicFor(map.music);
        if (music) {
            this.audio.playMusic(music);
        } else {
            this.audio.stopMusic();
        }
        this.paused = false;
        this.runRecorded = false;
        this.reportRun = this.options.stress
            ? undefined
            : startRunAnalytics(
                  sim,
                  this.coopRun && { isHost: this.coopRun.isHost, relay: this.coop.relayKind },
                  RUN_ANALYTICS_URL,
                  () => this.display.runStats,
              );
        this.tasksAnnounced.clear();
        this.accumulator = 0;
        this.shownDps = 0;
        this.shownDpsTick = 0;
        this.damageMeter.reset();
        this.coopBarBoss = undefined;
        this.appearanceVersions = [];
        this.lookChoices = [];
        this.decisionKey = "";
        this.autoChest = undefined;
        this.coopStopped = false;
        this.viewHero = sim.focus;
        this.assets.dropPlayers(sim.heroes.length);
        this.view.reset();
        this.view.pets.setPets(pets);
        this.cameraRig.pitch = RUN_PITCH;
        this.cameraRig.distance =
            isCoarsePointer && window.innerHeight <= PHONE_MAX_HEIGHT
                ? PHONE_RUN_DISTANCE
                : RUN_DISTANCE;
        this.cameraRig.yaw = 0;
        this.store.set({
            screen: "run",
            overlay: "none",
            choices: [],
            chest: undefined,
            result: undefined,
            toasts: [],
            party: [],
            waitingOn: [],
            revive: undefined,
        });
        this.updateHud(true);
        // A run that begins with picks to make (a boss fight's) shows them now:
        // the loop only steps the sim once they're made
        this.syncOverlay();
        if (this.coopRun?.isHost && this.coopRun.waitingForLoad) {
            this.store.toast("Waiting for everyone to arrive...", 3000);
        }
    }

    // Co-op sends what the player does to the host, to be done in the frame
    // it goes in (on every copy at once); on your own it's done now. Returns
    // false when it can't be done.
    private act(action: CoopAction): boolean {
        const sim = this.sim;
        if (!sim) {
            return false;
        }
        if (this.coopRun) {
            return this.coopRun.act(action);
        }
        const done = applyAction(sim, action);
        this.afterAction(action, done);
        return done;
    }

    // What follows something the player did, once it's done
    private afterAction(action: CoopAction, done: boolean): void {
        const sim = this.sim;
        if (!sim) {
            return;
        }
        switch (action.kind) {
            case "choose":
                this.syncOverlay();
                break;
            case "chest":
                this.handleEvents(sim, sim.takeEvents());
                this.syncOverlay();
                break;
            case "reroll":
                if (done) {
                    this.afterReroll(sim);
                } else {
                    this.sounds.denied();
                }
                break;
            // A banished reward greys out where it is
            case "banish":
                if (done) {
                    this.sounds.reroll();
                    this.store.set({ choices: getChoiceViews(sim) });
                } else {
                    this.sounds.denied();
                }
                break;
            // A locked reward greys out where it is
            case "lock":
                if (done) {
                    this.sounds.reroll();
                    this.store.set({ choices: getChoiceViews(sim) });
                } else {
                    this.sounds.denied();
                }
                break;
            // A banished item is alched, which is the casket done
            case "banishChest":
                if (done) {
                    this.handleEvents(sim, sim.takeEvents());
                    this.syncOverlay();
                } else {
                    this.sounds.denied();
                }
                break;
            case "skip":
                if (done) {
                    this.sounds.buy();
                    this.syncOverlay();
                } else {
                    this.sounds.denied();
                }
                break;
            case "item":
                if (done) {
                    this.handleEvents(sim, sim.takeEvents());
                    if (sim.state !== "playing") {
                        // A lamp's level up, or a blast that killed the boss
                        this.syncOverlay();
                    }
                }
                break;
            case "event":
                if (!done) {
                    this.sounds.denied();
                    return;
                }
                this.handleEvents(sim, sim.takeEvents());
                this.syncOverlay();
                break;
            case "leaveEvent":
                this.handleEvents(sim, sim.takeEvents());
                this.syncOverlay();
                break;
            case "ability":
                if (!done) {
                    this.sounds.denied();
                    break;
                }
                this.handleEvents(sim, sim.takeEvents());
                if (sim.state !== "playing") {
                    this.syncOverlay();
                }
                break;
        }
        this.updateHud(true);
    }

    choose(index: number): void {
        const sim = this.sim;
        if (!sim || !sim.isChoosing()) {
            return;
        }
        if (sim.isBanishedChoice(index) || sim.isLockedChoice(index)) {
            this.sounds.denied();
            return;
        }
        this.act({ kind: "choose", index });
    }

    // What the player chose with the open casket's item
    resolveChest(action: ChestAction): void {
        const sim = this.sim;
        if (!sim || sim.state !== "chest" || !sim.chest) {
            return;
        }
        this.act({ kind: "chest", action });
    }

    // Takes one of what a random event's visitor has on offer
    chooseEvent(index: number): void {
        const sim = this.sim;
        if (!sim || sim.state !== "event") {
            return;
        }
        // Checked here in co-op too, as with a reroll (see reroll): a key
        // pressed for something sold would hold up leaving
        if (this.coopRun && !sim.canChooseEventOption(index)) {
            this.sounds.denied();
            return;
        }
        this.act({ kind: "event", index });
    }

    // Walks away from what a random event's visitor has on offer
    leaveEvent(): void {
        const sim = this.sim;
        if (!sim || sim.state !== "event") {
            return;
        }
        this.act({ kind: "leaveEvent" });
    }

    // Rolls the level up's rewards or the open casket's item again, for one of
    // the run's rerolls. False when there's none left.
    reroll(): boolean {
        const sim = this.sim;
        if (!sim) {
            return false;
        }
        // Checked here too in co-op: an action the host turns away still counts
        // as this decision's answer (CoopRun.act), so a refused reroll would
        // hold up the real pick
        if (this.coopRun && (sim.rerollsLeft <= 0 || sim.choosingHilt)) {
            this.sounds.denied();
            return false;
        }
        return this.act({ kind: "reroll" });
    }

    private afterReroll(sim: Sim): void {
        if (sim.state === "chest" && this.autoChestAction(sim)) {
            // Auto equip takes the new item, with no casket to burst open
            this.syncOverlay();
        } else if (sim.state === "chest") {
            const chest = getChestView(sim);
            // The UI bursts the casket open again for the new item
            if (chest) {
                this.sounds.chest("open", chest.rarity);
            }
            this.store.set({ chest });
        } else {
            this.sounds.reroll();
            this.store.set({ choices: getChoiceViews(sim) });
        }
    }

    // Banishes a level up's reward (by its place), or with none the open
    // casket's item, for one of the run's banishes. False when it can't be.
    banish(index?: number): boolean {
        const sim = this.sim;
        if (!sim) {
            return false;
        }
        const allowed = index === undefined ? sim.canBanishChest : sim.canBanishChoice(index);
        // Checked here in co-op too, as with a reroll (see reroll)
        if (this.coopRun && !allowed) {
            this.sounds.denied();
            return false;
        }
        return this.act(index === undefined ? { kind: "banishChest" } : { kind: "banish", index });
    }

    // Locks a level up's reward (by its place) to come first at the next level
    // up, for one of the run's locks. False when it can't be.
    lock(index: number): boolean {
        const sim = this.sim;
        if (!sim) {
            return false;
        }
        // Checked here in co-op too, as with a banish
        if (this.coopRun && !sim.canLockChoice(index)) {
            this.sounds.denied();
            return false;
        }
        return this.act({ kind: "lock", index });
    }

    // Takes none of the level up's rewards, for coins from the run. False when
    // it can't be skipped or there aren't the coins.
    skip(): boolean {
        const sim = this.sim;
        if (!sim || sim.state !== "levelUp") {
            return false;
        }
        if (this.coopRun && (!sim.canSkip || sim.coins < sim.skipCost)) {
            this.sounds.denied();
            return false;
        }
        return this.act({ kind: "skip" });
    }

    // Uses the utility item in an inventory slot (0-3)
    useItem(index: number): void {
        const sim = this.sim;
        if (!sim || (this.paused && !this.coopRun) || !sim.inventory[index]) {
            return;
        }
        this.act({ kind: "item", index });
    }

    // The fight's own button (MapDef.fight.ability): Space, a pad's bottom button, or the touch
    // screen's. Out of reach, or not ready, it says no.
    useAbility(): void {
        const sim = this.sim;
        if (!sim?.map.fight?.ability || (this.paused && !this.coopRun)) {
            return;
        }
        this.act({ kind: "ability" });
    }

    // The opening animation's sounds, timed by the UI
    playChestSound(cue: ChestCue, rarity: Rarity): void {
        this.sounds.chest(cue, rarity);
    }

    // Co-op's menu doesn't stop the run: the others play on
    pause(): void {
        if (this.sim && !this.sim.runOver) {
            this.paused = true;
            this.syncOverlay();
        }
    }

    // The page lost its graphics (GameApp): a solo run stops where it stands, and
    // nothing happens to it while its player can't see it. Says what was going on.
    onGraphicsLost(): "none" | "solo" | "coop" {
        if (!this.sim || this.sim.runOver) {
            return "none";
        }
        if (this.coopRun) {
            return "coop";
        }
        this.pause();
        return "solo";
    }

    // Before the page reloads for its lost graphics: the run counts as the pause
    // menu's quit does (its coins and quests are kept), with nothing more drawn
    // or let go on the GPU
    endRunForReload(): void {
        if (this.sim) {
            this.finishRun(undefined, "disconnected");
        }
        if (this.coopRun) {
            this.coop.leave();
        }
    }

    resume(): void {
        this.paused = false;
        this.accumulator = 0;
        this.syncOverlay();
    }

    // Ends the run where it stands (from the pause menu); coins found are kept.
    // In co-op that's leaving the party (the host's leaving ends it for
    // everyone).
    quitRun(): void {
        if (this.sim) {
            this.finishRun();
        }
        if (this.coopRun) {
            this.coop.leave();
        }
        this.leaveRun();
    }

    // Back to the title screen after the results, or after a co-op run, back
    // to the room. show: false when the next run's starting straight away.
    // The same boss fight again, from its results (MapDef.fight), on your own
    retry(): void {
        const mapId = this.sim?.map.id;
        if (!mapId || this.coopRun || !getMap(mapId).fight) {
            return;
        }
        this.leaveRun();
        void this.startRun(mapId);
    }

    leaveRun(show = true): void {
        const wasCoop = this.coopRun !== undefined;
        if (wasCoop && show && this.coop.isHost) {
            // The room's open for the next run
            this.coop.end();
        }
        this.coopRun = undefined;
        this.stopBackgroundTicker();
        usePortableMath(false);
        this.assets.dropPlayers(1);
        this.sim = undefined;
        this.reportRun = undefined;
        this.paused = false;
        this.audio.stopMusic();
        this.grid = this.grids.get(TITLE_MAP.id)!;
        this.renderer.setPlane(this.grid.plane);
        this.renderer.setSmoothTerrain(false);
        this.renderer.setBrightness(1);
        this.shownBrightness = 1;
        this.renderer.setWash(undefined);
        this.shownWash = undefined;
        this.view.reset();
        this.cameraRig.pitch = ATTRACT_PITCH;
        this.cameraRig.distance = ATTRACT_DISTANCE;
        this.assets.setCharacterLook(this.store.getSnapshot().characterId);
        if (!show) {
            return;
        }
        this.store.setNumbers(undefined);
        this.store.set({
            screen: wasCoop && this.coop.room ? "coop" : "title",
            overlay: "none",
            hud: undefined,
            choices: [],
            chest: undefined,
            result: undefined,
            party: [],
            waitingOn: [],
            revive: undefined,
        });
    }

    // endedEarly: why a co-op run ended before anyone won or fell
    private finishRun(
        endedEarly?: string,
        early: "abandoned" | "disconnected" = endedEarly ? "disconnected" : "abandoned",
    ): void {
        const sim = this.sim;
        if (!sim || this.runRecorded) {
            return;
        }
        this.runRecorded = true;
        void this.reportRun?.(early);
        this.reportRun = undefined;
        const result = sim.getResult();
        const locked = MAPS.filter((m) => !isMapUnlocked(this.save, m.id));
        const lockedCharacters = CHARACTERS.filter(
            (c) => !c.only && !this.save.unlockedCharacters.includes(c.id),
        );
        const lockedItems = LOCKABLE_ITEMS.filter((i) => !this.save.unlockedItems.includes(i.id));
        const endlessRecord = result.endless && isEndlessRecord(this.save, result);
        const firstHardWin =
            result.hard &&
            result.victory &&
            !isDevMap(sim.map.id) &&
            !this.save.hardVictories[sim.map.id];
        const newGear = isDevMap(sim.map.id)
            ? []
            : result.gearFound.filter((id) => !this.save.foundGear.includes(id));
        const newTrophies = isDevMap(sim.map.id)
            ? []
            : result.trophies.filter((id) => !this.save.trophies.includes(id));
        // A co-op run's numbers can come from another player's modified game,
        // and a NaN in a solo one's would come back from the save as 0 coins
        const quests = hasBadNumber(result) ? [] : recordRun(this.save, result);
        this.persist();
        const unlockedMap = locked.find((m) => isMapUnlocked(this.save, m.id));
        const unlockedCharacters = lockedCharacters.filter((c) =>
            this.save.unlockedCharacters.includes(c.id),
        );
        const unlockedItems = lockedItems.filter((i) => this.save.unlockedItems.includes(i.id));
        if (unlockedMap) {
            // Ready for the next run
            this.store.set({ mapId: unlockedMap.id, endless: false, hard: false });
        }
        // Teammates' pages too, unless one of them has a number that isn't
        const players = getPlayerResultViews(sim);
        this.store.set({
            result: {
                ...result,
                players: players.some(hasBadNumber) ? players.filter((p) => p.isLocal) : players,
                bossKills: getBossKillViews(result.stats),
                endlessRecord,
                firstHardWin,
                unlockedMap: unlockedMap?.name,
                unlockedCharacters: unlockedCharacters.map((c) => c.name),
                unlockedItems: unlockedItems.map((i) => i.name),
                newGear: newGear.map((id) => getItem(id).name),
                newTrophies: newTrophies.map((id) => TROPHY_BY_ID.get(id)!.name),
                quests: quests.map((q) => ({ name: q.name, coins: q.coins })),
                ...(sim.heroes.length > 1 && {
                    party: sim.heroes.filter((h) => h.index !== sim.focus).map((h) => h.name),
                }),
                endedEarly,
            },
        });
        // The room sees this player's new unlocks and upgrades next run
        this.coop.setMe({ loadout: this.getLoadout(), unlocks: this.getUnlocks() });
    }

    // A task or quest done mid-run: the adventurer or item joins, and the
    // quest pays out, once the run is over, however it ends (beating the map
    // shows on the results instead)
    private announceTasks(sim: Sim): void {
        if (sim.runOver || isDevMap(sim.map.id)) {
            return;
        }
        const result = sim.getResult();
        const earned = getEarnedUnlocks(this.save, result);
        const news = [
            ...earned.characters.map((c) => ({
                key: `character:${c.id}`,
                task: c.unlock!,
                text: `The ${c.name} joins you after this run.`,
            })),
            ...earned.items.map((i) => ({
                key: `item:${i.id}`,
                task: i.unlock,
                text: `${i.name} ${i.kind === "item" ? "joins the loot" : "can be found"} after this run.`,
            })),
        ];
        for (const { key, task, text } of news) {
            if (!this.tasksAnnounced.has(key)) {
                this.tasksAnnounced.add(key);
                this.sounds.taskDone();
                this.store.toast(`Task done: ${describeUnlockTask(task)}! ${text}`, 6000);
            }
        }
        for (const quest of getFinishedQuests(this.save, result)) {
            const key = `quest:${quest.id}`;
            if (!this.tasksAnnounced.has(key)) {
                this.tasksAnnounced.add(key);
                this.sounds.taskDone();
                this.store.toast(
                    `Quest complete: ${quest.name}! ${quest.coins.toLocaleString()} coins ` +
                        "are yours after this run.",
                    6000,
                );
            }
        }
    }

    private onKeyPress = (code: string): void => {
        if (code === "F3") {
            this.store.set({ debug: !this.store.getSnapshot().debug });
            return;
        }
        if (code === "KeyM") {
            this.toggleMute();
            return;
        }
        if (code === "KeyQ" && this.sim) {
            this.toggleQuestTracker();
            return;
        }
        if (code === "Tab" && this.isPlaying()) {
            this.toggleDamagePanel();
            return;
        }
        const sim = this.sim;
        if (!sim) {
            return;
        }
        const overlay = this.store.getSnapshot().overlay;
        if (code === "Escape" || code === "KeyP") {
            if (overlay === "paused") {
                this.resume();
            } else if (overlay === "none") {
                this.pause();
            } else if (overlay === "event" && code === "Escape") {
                this.leaveEvent();
            }
        } else if (overlay === "event" && code.startsWith("Digit")) {
            this.chooseEvent(parseInt(code.slice(5)) - 1);
        } else if (overlay === "levelUp" && code.startsWith("Digit")) {
            const index = parseInt(code.slice(5)) - 1;
            if (index >= 0 && index < sim.choices.length) {
                this.choose(index);
            }
        } else if (overlay === "paused" && this.coopRun && code.startsWith("Digit")) {
            // The run goes on behind co-op's menu
            this.useItem(parseInt(code.slice(5)) - 1);
        } else if (
            (overlay === "none" || (overlay === "paused" && this.coopRun)) &&
            code === "Space"
        ) {
            this.useAbility();
        } else if (overlay === "levelUp" && code === "KeyR") {
            this.reroll();
        } else if (overlay === "levelUp" && code === "KeyX") {
            this.skip();
        } else if (overlay === "none" && code.startsWith("Digit")) {
            // The casket screen has its own keys (it knows when its animation
            // is done)
            this.useItem(parseInt(code.slice(5)) - 1);
        }
    };

    // ---- Frame ----

    update(deltaTimeMs: number, camera: Camera): void {
        this.renderer.fpsLimit = frameCap(
            this.display.frameRate,
            isCoarsePointer,
            this.isStoppedBehindMenu(),
        );
        this.fps = this.fps * 0.95 + (deltaTimeMs > 0 ? 1000 / deltaTimeMs : 0) * 0.05;
        this.input.pollPads(performance.now(), this.isPlaying() ? "run" : "menu");
        const wheel = this.input.takeWheel();
        if (wheel !== 0 && this.sim) {
            this.cameraRig.zoom(wheel);
        }
        this.store.expireToasts();

        setPlayArea(this.renderer, this.grid, this.sim?.map.scaperune === true);

        const sim = this.sim;
        if (!sim) {
            this.updateAttract(deltaTimeMs, camera);
            return;
        }

        if (this.coopRun) {
            this.updateCoop(deltaTimeMs, sim, this.coopRun);
        } else if (!this.paused && (sim.state === "playing" || sim.runOver)) {
            const wasOver = sim.runOver;
            this.accumulator = Math.min(
                this.accumulator + deltaTimeMs,
                TICK_MS * MAX_TICKS_PER_FRAME,
            );
            let steps = 0;
            while (
                this.accumulator >= TICK_MS &&
                steps < SOLO_TICKS_PER_FRAME &&
                (sim.state === "playing" || sim.runOver)
            ) {
                steps++;
                this.accumulator -= TICK_MS;
                const move = this.input.getMoveVector(this.move);
                sim.step(move.x, move.y);
                this.handleEvents(sim, sim.takeEvents());
            }
            if (sim.state !== "playing" && !wasOver) {
                this.syncOverlay();
                // Auto alch can have the run going again, with no time lost
                if (!sim.runOver && this.store.getSnapshot().overlay !== "none") {
                    this.accumulator = 0;
                }
            }
        }

        for (const hero of sim.heroes) {
            // A level-up offering a weapon bakes its swing ahead of the pick
            const choices = hero.choices.length > 0 ? hero.choices : undefined;
            if (
                hero.appearanceVersion !== this.appearanceVersions[hero.index] ||
                choices !== this.lookChoices[hero.index]
            ) {
                this.appearanceVersions[hero.index] = hero.appearanceVersion;
                this.lookChoices[hero.index] = choices;
                this.assets.setPlayerAppearance(
                    getRunAppearance(sim, hero.index),
                    hero.index,
                    getRunAttackSeqs(sim, hero.index),
                    getOfferedAttackSeqs(sim, hero.index),
                );
            }
        }

        const now = performance.now();
        if (now - this.lastHudUpdate > HUD_INTERVAL_MS) {
            this.updateHud(false);
            this.announceTasks(sim);
        }

        this.viewHero = this.getViewHero(sim);
        this.view.viewHero = this.viewHero;
        const alpha = this.getAlpha();
        this.view.localPlayerPose = this.coopStopped
            ? undefined
            : this.coopRun?.prediction?.render(alpha);
        // Pets walk behind their players as they're drawn: a co-op guest's own hero where
        // prediction has them, ahead of the sim
        const predicted = this.view.localPlayerPose;
        this.view.pets.update(sim, (hero) =>
            predicted?.hero === hero ? predicted : sim.heroes[hero]?.player,
        );
        const { x: px, y: py } = getPlayerPose(
            sim,
            this.viewHero,
            alpha,
            this.view.localPlayerPose,
        );
        // Aim at the player's chest, not their feet
        let ground = this.grid.getHeight(px, py) / 128;
        if (sim.map.scaperune) {
            const last = this.cameraGround ?? ground;
            ground = last + (ground - last) * (1 - Math.exp(-deltaTimeMs / CAMERA_GROUND_EASE));
            this.cameraGround = ground;
        }
        const lean = this.getRaidRoomLean(sim, now) ?? this.getBossLean(sim, px, py);
        const ease = 1 - Math.exp(-deltaTimeMs / BOSS_LEAN_EASE);
        this.cameraLean.x += (lean.x - this.cameraLean.x) * ease;
        this.cameraLean.y += (lean.y - this.cameraLean.y) * ease;
        const pan = this.getIntroPan(sim, px, py, alpha);
        const shake = this.getShake(now);
        this.cameraRig.apply(
            camera,
            px + this.cameraLean.x + pan.x + shake.x,
            ground - 0.6,
            py + this.cameraLean.y + pan.y + shake.y,
        );
        this.cameraOffsetY = this.cameraLean.y + pan.y + shake.y;
        // A raid hall can be drawn darker than the map, and washed with a colour
        // (RaidRoomDef.hall)
        const hall =
            sim.map.raid && sim.raidStage === "waves"
                ? sim.map.raid.rooms[sim.raidRoom].hall
                : undefined;
        const hallBrightness = hall?.brightness;
        if (hall?.wash !== this.shownWash) {
            this.shownWash = hall?.wash;
            this.renderer.setWash(hall?.wash);
        }
        // A gaze's light, brought up as it winds up and let down after (BossAttackDef.cover),
        // eased both ways so it never steps
        const light = getGazeLight(sim);
        this.gazeLight += (light - this.gazeLight) * (1 - Math.exp(-deltaTimeMs / GAZE_LIGHT_EASE));
        const brightness = (hallBrightness ?? sim.map.brightness ?? 1) * this.gazeLight;
        if (brightness !== this.shownBrightness) {
            this.shownBrightness = brightness;
            this.renderer.setBrightness(brightness);
        }
    }

    // The fight's own button, for the HUD (MapDef.fight.ability)
    private getAbilityView(sim: Sim): AbilityView | undefined {
        const ability = sim.map.fight?.ability;
        if (!ability) {
            return undefined;
        }
        const boss = sim.shownBoss;
        const left = sim.abilitySecondsLeft();
        return {
            name: ability.name,
            iconObjId: ability.iconObjId,
            charge: Math.round((1 - left / ability.cooldown) * 20) / 20,
            inReach: sim.abilityTarget() !== undefined,
            opened: boss !== undefined && !boss.dead && sim.isExposed(boss),
        };
    }

    // A blow at (x, y) shakes the camera, less the further off the player it is, and not at
    // all for someone who's turned it off (or asked their system for less motion)
    private startShake(sim: Sim, x: number, y: number, strength: number): void {
        if (!this.display.screenShake || strength <= 0) {
            return;
        }
        const player = sim.heroes[this.viewHero]?.player ?? sim.player;
        const away = Math.hypot(x - player.x, y - player.y);
        const near = Math.min(1, Math.max(0, (SHAKE_FAR - away) / (SHAKE_FAR - SHAKE_NEAR)));
        const now = performance.now();
        const left = this.shakeLeft(now);
        this.shake = { strength: Math.max(left, strength * near), start: now };
    }

    // What's left of the shake, fading out over SHAKE_MS
    private shakeLeft(now: number): number {
        const t = (now - this.shake.start) / SHAKE_MS;
        return t >= 1 ? 0 : this.shake.strength * (1 - t) * (1 - t);
    }

    // The camera's offset for it now, in tiles: a quick wobble, both ways
    private getShake(now: number): { x: number; y: number } {
        const left = this.shakeLeft(now);
        if (left <= 0) {
            return { x: 0, y: 0 };
        }
        const reach = left * SHAKE_TILES;
        return { x: Math.sin(now * 0.09) * reach, y: Math.cos(now * 0.077) * reach };
    }

    // A boss's intro that pans (BossIntroDef.pan): from the player to where it rises, held
    // there, then eased back to the player
    private getIntroPan(sim: Sim, px: number, py: number, alpha: number): { x: number; y: number } {
        const intro = sim.intro;
        const pan = intro?.def.boss?.intro?.pan;
        const rise = sim.map.features?.rise;
        if (!intro || !pan) {
            return { x: 0, y: 0 };
        }
        const at = intro.boss ?? rise;
        if (!at) {
            return { x: 0, y: 0 };
        }
        const seconds = (sim.tick + alpha - intro.startTick) / TICKS_PER_SECOND;
        const t = Math.min(1, Math.max(0, (seconds - pan.from) / pan.over));
        const away = 1 - t * t * (3 - 2 * t);
        return { x: (at.x - px) * away, y: (at.y - py) * away };
    }

    // In a raid's boss room, while its boss is up: north just far enough that its head, and its
    // overhead prayer, are below the boss bar (up to RAID_LEAN_MAX), measured on last frame's
    // camera. Undefined anywhere else.
    private getRaidRoomLean(sim: Sim, now: number): { x: number; y: number } | undefined {
        const boss = sim.shownBoss;
        if (!sim.map.raid || sim.raidStage !== "boss" || !boss || boss.dead || sim.intro) {
            return undefined;
        }
        const overlay = this.overlay;
        if (overlay.height === 0) {
            return { x: 0, y: 0 };
        }
        // Where its overhead prayer's drawn from (BossFightView.drawOverheads), and the icon's top
        const model = this.assets.get(getEnemyModelKey(boss.def, boss.variant));
        const top =
            this.grid.getHeight(boss.x, boss.y) / 128 -
            ((model?.height ?? 128) * boss.scale) / 128 -
            OVERHEAD_GAP;
        const icon = this.assets.getSprite(PRAYER_HEADICON_SPRITE, PRAYER_HEADICON_FRAME_IDS[0]);
        const iconHeight = (icon?.height ?? 25) * OVERHEAD_SCALE * overlay.uiScale;
        const head = overlay.project(boss.x, top, boss.y, this.leanPoint).y - iconHeight;
        // How far up the screen a tile further north moves it
        const perTile =
            head + iconHeight - overlay.project(boss.x, top, boss.y + 1, this.leanPoint).y;
        if (!(perTile > 0)) {
            return { x: 0, y: this.cameraLean.y };
        }
        // Leaning north moves everything down the screen by perTile a tile. Last frame's camera
        // was off by all of cameraOffsetY (its lean, and a shake), so the lean wanted is that and
        // what's short of it.
        const lean = this.cameraOffsetY + (this.getBossBarBottom(now) - head) / perTile;
        return { x: 0, y: lean > RAID_LEAN_MAX ? 0 : Math.max(0, lean) };
    }

    // The boss bar's bottom edge in the overlay's pixels, looked up now and then (a layout read)
    private getBossBarBottom(now: number): number {
        if (!this.bossBarBottom || now - this.bossBarBottom.at > 500) {
            const bar = document.querySelector(".ui-boss-bar")?.getBoundingClientRect();
            const overlay = this.overlay;
            const scale = overlay.height / Math.max(1, overlay.canvas.offsetHeight);
            const canvasTop = overlay.canvas.getBoundingClientRect().top;
            this.bossBarBottom = { y: bar ? (bar.bottom - canvasTop) * scale : 0, at: now };
        }
        return this.bossBarBottom.y;
    }

    // Towards a boss that asks for it (BossLookDef.lean), wherever it is
    private getBossLean(sim: Sim, px: number, py: number): { x: number; y: number } {
        const boss = sim.shownBoss;
        const at = boss?.def.boss?.look?.lean && !boss.dead && !sim.intro ? boss : undefined;
        if (!at) {
            return { x: 0, y: 0 };
        }
        const dx = (at.x - px) * BOSS_LEAN;
        const dy = (at.y - py) * BOSS_LEAN;
        const length = Math.hypot(dx, dy);
        const scale = length > BOSS_LEAN_MAX ? BOSS_LEAN_MAX / length : 1;
        return { x: dx * scale, y: dy * scale };
    }

    // Nothing but the scenery moves: the title screen, or a solo run that's stopped
    // for a menu (a level up, a casket, the pause menu, the results). A co-op run
    // carries on behind its menus.
    private isStoppedBehindMenu(): boolean {
        const sim = this.sim;
        if (!sim) {
            return true;
        }
        return !this.coopRun && (this.paused || sim.state !== "playing");
    }

    // A co-op run: frames step at the run's pace, the host's whenever it
    // likes, a guest's as the host's arrive (catching up if it's fallen
    // behind). The menu doesn't stop it, and neither does a level up: the
    // frames carry everyone's choices.
    private updateCoop(deltaTimeMs: number, sim: Sim, run: CoopRun): void {
        if (this.coopStopped) {
            return;
        }
        const move = this.input.getMoveVector(this.move);
        // Standing still while choosing (the menu doesn't stop the run, so
        // moving goes on behind it)
        const deciding = this.store.getSnapshot().overlay !== "none" && !this.paused;
        run.setMove(deciding ? 0 : move.x, deciding ? 0 : move.y);
        this.accumulator += Math.min(deltaTimeMs, TICK_MS * MAX_TICKS_PER_FRAME);
        const catchUp = run.isHost ? 0 : Math.max(0, run.behind - GUEST_BUFFER_FRAMES);
        const started = performance.now();
        let steps = 0;
        while (run.canStep() && steps < MAX_CATCH_UP_TICKS) {
            if (this.accumulator >= TICK_MS) {
                this.accumulator -= TICK_MS;
            } else if (steps >= catchUp || performance.now() - started > CATCH_UP_BUDGET_MS) {
                break;
            }
            steps++;
            const events = run.stepFrame();
            this.handleEvents(sim, sim.takeEvents());
            for (const event of events) {
                if (event.action && event.hero === sim.focus) {
                    this.afterCoopAction(sim, event.action);
                    if (event.auto) {
                        this.store.toast(
                            "Everyone was waiting, so that was decided for you.",
                            4000,
                        );
                    }
                }
            }
        }
        if (!run.canStep()) {
            // Waiting on the host: no time to make up once it's back
            this.accumulator = Math.min(this.accumulator, TICK_MS);
        }
        run.flush();
        if (run.desynced && !this.runRecorded) {
            // Nothing brings the copies back together, so this one stops
            // rather than everyone waiting on it
            this.coop.leave();
            this.endCoopRunEarly("Your game fell out of step with the host's, so your run ended.");
            return;
        }
        // Choices and caskets come and go with the frames
        const key = this.getDecisionKey(sim);
        if (key !== this.decisionKey) {
            this.decisionKey = key;
            this.syncOverlay();
        }
        // Only while frames are coming: a reconnecting lobby holds what's
        // sent, and a pile of answers would go on to the next caskets
        if (steps > 0) {
            this.resendAutoChest(sim, run);
        }
    }

    // An automatic casket answer still waiting for its frame: CoopRun.act
    // drops it until it's waited long enough to be lost or turned away, then
    // sends it again. The casket's hidden, so there's nothing to click.
    private resendAutoChest(sim: Sim, run: CoopRun): void {
        const answer = this.autoChest;
        if (answer && sim.state === "chest" && sim.chest?.uid === answer.uid) {
            run.act({ kind: "chest", action: answer.action });
        }
    }

    // What's come for a co-op run before its copy's made (toCoopRun), and
    // each hero's player id
    private coopInbox?: ((run: CoopRun) => void)[];
    private coopPlayerIds: string[] = [];
    // A co-op run that's ended early for this player (endCoopRunEarly)
    private coopStopped = false;
    // Ticks for a co-op player whose tab is hidden (see onVisibilityChange)
    private backgroundTicker?: Worker;
    private backgroundTime = 0;

    // A hidden tab isn't drawn, and its frames stop with it, so a co-op
    // player keeps stepping off a worker's timer (a page's own timers are
    // slowed right down in a hidden tab, a worker's aren't): the host keeps
    // the run going for everyone, and a guest keeps up rather than having
    // minutes to catch up on when they're back
    private onVisibilityChange = (): void => {
        this.stopBackgroundTicker();
        if (document.hidden && this.coopRun) {
            this.backgroundTime = performance.now();
            const source = `setInterval(() => postMessage(0), ${TICK_MS});`;
            const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
            this.backgroundTicker = new Worker(url);
            URL.revokeObjectURL(url);
            this.backgroundTicker.onmessage = () => {
                const sim = this.sim;
                const run = this.coopRun;
                const now = performance.now();
                if (sim && run && document.hidden) {
                    this.updateCoop(now - this.backgroundTime, sim, run);
                }
                this.backgroundTime = now;
            };
        } else {
            this.stopBackgroundTicker();
        }
    };

    private stopBackgroundTicker(): void {
        this.backgroundTicker?.terminate();
        this.backgroundTicker = undefined;
    }

    // A co-op action of this player's, now it's been done in its frame
    private afterCoopAction(sim: Sim, action: CoopAction): void {
        if (action.kind === "reroll") {
            this.afterReroll(sim);
        } else if (action.kind === "skip") {
            this.sounds.buy();
        }
        this.updateHud(true);
    }

    // What the run's waiting on, in a form that changes when any of it does
    private getDecisionKey(sim: Sim): string {
        const hero = sim.heroes[sim.focus];
        return [
            sim.state,
            hero.down,
            hero.pendingLevelUps,
            hero.choices.map((c) => c.kind + ("weaponId" in c ? c.weaponId : "")).join(),
            sim.chest?.uid ?? 0,
            sim.chest?.itemId ?? "",
            sim.offer?.uid ?? 0,
            sim.offer?.options.filter((o) => o.kind === "powerUp" && o.sold).length ?? 0,
            sim.waitingOn.map((h) => h.index).join(),
        ].join("|");
    }

    // The camera's on this player, or on a teammate who's still up while
    // they're down
    private getViewHero(sim: Sim): number {
        const own = sim.heroes[sim.focus];
        if (sim.isUp(own) || sim.runOver) {
            return sim.focus;
        }
        const current = sim.heroes[this.viewHero];
        if (current && current !== own && sim.isUp(current)) {
            return current.index;
        }
        const up = sim.heroes.find((hero) => sim.isUp(hero));
        return up?.index ?? sim.focus;
    }

    private getAlpha(): number {
        const sim = this.sim;
        if (!sim || (this.paused && !this.coopRun) || sim.state !== "playing") {
            return 1;
        }
        return Math.min(1, this.accumulator / TICK_MS);
    }

    // Title screen: the character idles in the courtyard while the camera
    // circles them (unless that's turned off)
    private updateAttract(deltaTimeMs: number, camera: Camera): void {
        const ticks = deltaTimeMs / TICK_MS;
        this.attractTick += ticks;
        if (this.display.menuSpin) {
            this.attractYaw = (this.attractYaw + ticks * ATTRACT_SPIN) % 2048;
        } else {
            // Back round to the front the short way
            const offset = this.attractYaw > 1024 ? this.attractYaw - 2048 : this.attractYaw;
            const settled = offset * Math.pow(ATTRACT_SETTLE, ticks);
            this.attractYaw = Math.abs(settled) < 1 ? 0 : (settled + 2048) % 2048;
        }
        this.cameraRig.yaw = this.attractYaw & 2047;
        const { x, y } = TITLE_MAP.spawn;
        this.cameraRig.apply(camera, x, this.grid.getHeight(x, y) / 128 - 0.8, y);
    }

    private handleEvents(sim: Sim, events: SimEvent[]): void {
        if (events.length === 0) {
            return;
        }
        this.view.onEvents(sim, events);
        this.sounds.onEvents(sim, events, this.viewHero);
        for (const event of events) {
            if (event.type === "bossImpact") {
                this.startShake(sim, event.x, event.y, event.shake);
                continue;
            }
            // Co-op: a teammate's own events, said with their name if at all
            if (event.hero !== undefined && event.hero !== sim.focus) {
                this.teammateToast(sim, sim.heroes[event.hero].name, event);
                continue;
            }
            switch (event.type) {
                case "casketDropped":
                    this.store.toast(`A ${CASKETS[event.tier].name.toLowerCase()} drops!`);
                    break;
                case "bossSpawned":
                case "bossRose":
                case "bossEnraged":
                case "bossStage":
                    // Bosses that turn up together say so once (Pest Control's
                    // portals, on the first)
                    if (event.message) {
                        this.store.toast(event.message, 6000);
                    }
                    break;
                case "coinsStolen":
                    this.store.toast(
                        `The ${getEnemy(event.enemyId).name} grabs ${event.amount} of your coins!`,
                    );
                    break;
                case "coinsReturned":
                    this.store.toast(`You get your ${event.amount} coins back!`);
                    break;
                case "revive":
                    this.store.toast("Your ring of life saves you!");
                    break;
                case "roundStarted":
                    this.store.toast(describeRound(sim), 7000);
                    break;
                case "powerUp":
                case "notice":
                    this.store.toast(event.message);
                    break;
                case "heroDown":
                    this.store.toast(
                        sim.canBeRevived(sim.heroes[sim.focus])
                            ? "You're down! A teammate standing over you for a few seconds can revive you."
                            : "You're down! Watch the rest of your party fight on.",
                        5000,
                    );
                    break;
                case "heroRevived":
                    this.store.toast(
                        `${sim.heroes[event.by].name} revives you! Nothing can hurt you for ${REVIVE_IMMUNITY_SECONDS / 60} minutes.`,
                        6000,
                    );
                    break;
                case "extraRevive":
                    this.store.toast(
                        `A teammate can revive you once more (${describeRevives(sim.revivesLeftFor(sim.heroes[sim.focus]))}).`,
                        6000,
                    );
                    break;
                case "visitor":
                    if (event.message) {
                        this.store.toast(event.message);
                    }
                    break;
                // An automatic answer had no casket screen to show what it was
                case "alch":
                    if (this.autoChestDone(sim)) {
                        this.store.toast(
                            `High alched ${getItem(event.itemId).name} for ${event.coins.toLocaleString()} coins`,
                        );
                    }
                    break;
                case "equip":
                    if (this.autoChestDone(sim)) {
                        this.store.toast(
                            `Equipped ${getItem(event.itemId).name}` +
                                (event.replacedId
                                    ? `; high alched ${getItem(event.replacedId).name} for ${event.coins.toLocaleString()} coins`
                                    : ""),
                        );
                    }
                    break;
            }
        }
    }

    private teammateToast(sim: Sim, name: string, event: SimEvent): void {
        switch (event.type) {
            case "heroDown":
                this.store.toast(
                    sim.canBeRevived(sim.heroes[event.hero!])
                        ? `${name} is down! Stand over them to revive them.`
                        : `${name} is down!`,
                    5000,
                );
                break;
            case "heroRevived":
                this.store.toast(
                    event.by === sim.focus
                        ? `You revive ${name}!`
                        : `${sim.heroes[event.by].name} revives ${name}!`,
                );
                break;
            case "extraRevive":
                this.store.toast(`${name} can be revived once more.`);
                break;
            case "heroLeft":
                this.store.toast(`${name} left the game.`);
                break;
            case "revive":
                this.store.toast(`${name}'s ring of life saves them!`);
                break;
            case "powerUp":
                this.store.toast(`${name} picked up the ${getPowerUp(event.id).name}!`);
                break;
        }
    }

    // What Auto alch or Auto equip would do with the open casket's item, if
    // either takes it (Auto alch first)
    private autoChestAction(sim: Sim): ChestAction | undefined {
        const chest = sim.state === "chest" ? sim.chest : undefined;
        if (!chest) {
            return undefined;
        }
        if (this.display.autoAlch) {
            return "alch";
        }
        const item = getItem(chest.itemId);
        return this.display.autoEquip &&
            shouldAutoEquip(sim.gear, sim.gearUpgrades, item, chest.upgrades)
            ? "take"
            : undefined;
    }

    // Answers the open casket for Auto alch or Auto equip, as its button
    // would, with no casket screen (co-op's answer takes a frame or more to
    // come back, and the menu can still open meanwhile). False when the
    // casket's the player's to answer.
    private autoAnswerChest(sim: Sim, waitingOn: string[]): boolean {
        const chest = sim.chest;
        if (!chest) {
            return false;
        }
        const answered = this.autoChest?.uid === chest.uid;
        const action = answered ? undefined : this.autoChestAction(sim);
        if (!answered && !action) {
            return false;
        }
        const overlay = this.paused ? "paused" : "none";
        this.store.set({ overlay, chest: undefined, choices: [], waitingOn });
        if (!action) {
            // Sent already (resendAutoChest sends a lost one again)
            return true;
        }
        this.autoChest = { uid: chest.uid, action };
        if (this.act({ kind: "chest", action })) {
            return true;
        }
        this.autoChest = undefined;
        return false;
    }

    // Whether an alch or equip just done was the automatic answer's (which is
    // then over), rather than the player's own click
    private autoChestDone(sim: Sim): boolean {
        const answer = this.autoChest;
        if (!answer || sim.chests.some((chest) => chest.uid === answer.uid)) {
            return false;
        }
        this.autoChest = undefined;
        return true;
    }

    // Shows whichever modal the run's state calls for
    private syncOverlay(): void {
        const sim = this.sim;
        if (!sim) {
            return;
        }
        // Co-op: who else the run's waiting on
        const waitingOn = sim.waitingOn
            .filter((hero) => hero.index !== sim.focus)
            .map((hero) => hero.name);
        if (sim.state === "dead" || sim.state === "victory") {
            if (sim.state === "dead" && !this.runRecorded) {
                this.sounds.playerDied();
            }
            this.finishRun();
            this.store.set({ overlay: sim.state, choices: [], chest: undefined, waitingOn: [] });
            this.updateHud(true);
        } else if (sim.state === "chest" && sim.chest) {
            if (this.autoAnswerChest(sim, waitingOn)) {
                return;
            }
            // Any earlier automatic answer is done, as this one's first in line
            this.autoChest = undefined;
            const chest = getChestView(sim);
            const shown = this.store.getSnapshot();
            // Co-op: the same casket again keeps its animation where it is
            if (!this.coopRun || shown.overlay !== "chest" || chest?.uid !== shown.chest?.uid) {
                this.store.set({ overlay: "chest", chest, choices: [], waitingOn });
            }
        } else if (sim.state === "event" && sim.offer?.hero === sim.focus) {
            this.store.set({
                overlay: "event",
                event: getEventView(sim),
                choices: [],
                chest: undefined,
                waitingOn,
            });
        } else if (sim.isChoosing()) {
            const was = this.store.getSnapshot().overlay;
            if (was !== "levelUp" || !this.coopRun) {
                this.sounds.levelUp();
            }
            this.store.set({
                overlay: "levelUp",
                choices: getChoiceViews(sim),
                chest: undefined,
                waitingOn,
            });
        } else if (this.paused) {
            this.store.set({ overlay: "paused", choices: [], chest: undefined, waitingOn });
        } else {
            this.store.set({ overlay: "none", choices: [], chest: undefined, waitingOn });
        }
    }

    // Co-op: the boss bar shows the living boss nearest this player (each player their own,
    // the final boss no more than any other), and keeps showing it until another is
    // BOSS_BAR_SWITCH tiles nearer. Once every final boss has fallen, the last one's empty bar
    // stays to the victory screen, as solo (Sim.shownBoss)
    private getCoopBarBoss(sim: Sim): Enemy | undefined {
        const player = sim.player;
        let nearest: Enemy | undefined;
        // Squared: only the two compared at the end need their roots
        let nearestDistance = Infinity;
        let keptDistance = Infinity;
        let fallen: Enemy | undefined;
        let finalUp = false;
        for (const enemy of sim.enemies) {
            if (!enemy.boss) {
                continue;
            }
            if (enemy.dead) {
                if (enemy.finalBoss && !sim.endless) {
                    fallen = enemy;
                }
                continue;
            }
            if (enemy.finalBoss) {
                finalUp = true;
            }
            const dx = enemy.x - player.x;
            const dy = enemy.y - player.y;
            const distance = dx * dx + dy * dy;
            if (enemy === this.coopBarBoss) {
                keptDistance = distance;
            }
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = enemy;
            }
        }
        if (fallen && !finalUp) {
            this.coopBarBoss = undefined;
            return fallen;
        }
        // (one that's gone or fallen has no distance, so gives way)
        if (Math.sqrt(keptDistance) - Math.sqrt(nearestDistance) < BOSS_BAR_SWITCH) {
            return this.coopBarBoss;
        }
        this.coopBarBoss = nearest;
        return nearest;
    }

    private updateHud(force: boolean): void {
        const sim = this.sim;
        if (!sim) {
            return;
        }
        this.lastHudUpdate = performance.now();
        const thisLevel = sim.xpForThisLevel;
        const nextLevel = sim.xpForNextLevel;
        let boss: HudNumbers["boss"];
        const shownBoss = sim.heroes.length > 1 ? this.getCoopBarBoss(sim) : sim.shownBoss;
        if (shownBoss) {
            const phase = shownBoss.bossState?.phase;
            const parasite = sim.parasite;
            boss = {
                name: shownBoss.def.name,
                fraction: shownBoss.dead ? 0 : shownBoss.hp / shownBoss.maxHp,
                enraged: !shownBoss.dead && (shownBoss.bossState?.enraged ?? false),
            };
            if (phase && !shownBoss.dead) {
                const phases = shownBoss.def.boss?.phases;
                const finale = phases?.finale;
                boss.fraction =
                    phase.stage === "finale" && finale
                        ? Math.max(0, (phase.finaleEnd ?? 0) - sim.tick) /
                          (finale.seconds * TICKS_PER_SECOND)
                        : phase.stage === "hp"
                          ? getPhaseBarFraction(shownBoss, phase.index)
                          : phase.shield / phase.shieldMax;
                const reach = sim.map.fight?.strikeReach;
                const player = sim.player;
                boss.fight = {
                    phase: phase.index + 1,
                    phases: phases?.phases.length ?? 1,
                    stage: phase.stage,
                    status:
                        phase.stage === "finale" ? undefined : phases?.phases[phase.index]?.status,
                    outOfReach:
                        reach !== undefined &&
                        Math.hypot(shownBoss.x - player.x, shownBoss.y - player.y) > reach,
                    guard: sim.isStunned(shownBoss)
                        ? "stunned"
                        : sim.isExposed(shownBoss)
                          ? "exposed"
                          : undefined,
                    totems: phase.totems.map((totem) =>
                        phase.stage === "shield" ? 0 : 1 - Math.max(0, totem.hp) / totem.maxHp,
                    ),
                    curseAttacks: sim.curse?.attacksLeft,
                    parasiteSeconds: parasite
                        ? Math.max(0, (parasite.burstTick - sim.tick) / TICKS_PER_SECOND)
                        : undefined,
                };
            }
        }
        if (sim.tick - this.shownDpsTick >= DPS_HOLD_TICKS) {
            this.shownDps = sim.dps;
            this.shownDpsTick = sim.tick;
        }
        this.damageMeter.sample(sim.tick, sim.damageBySource);
        const meter = this.damageMeter.read();
        const weaponDamage: HudNumbers["weaponDamage"] = {};
        for (const w of sim.weapons) {
            weaponDamage[w.def.id] = {
                dps: meter.perSecond[`weapon:${w.def.id}`] ?? 0,
                damage: meter.totals[`weapon:${w.def.id}`] ?? 0,
            };
        }
        const numbers: HudNumbers = {
            // Whole seconds, as they're shown, so standing still changes nothing
            bossIn: Math.ceil(sim.timeLeftForBoss),
            raidRoom: sim.map.raid && {
                number: sim.raidRoom + 1,
                count: sim.map.raid.rooms.length,
                name: sim.map.raid.rooms[sim.raidRoom].name,
                points: sim.raidPoints,
                waves: sim.raidStage === "waves",
                portal: sim.raidTeleporter !== undefined && sim.raidTeleportsLeft > 0,
                first: (this.save.mapVictories[sim.map.id] ?? 0) === 0,
            },
            hp: Math.max(0, Math.round(sim.player.hp)),
            maxHp: sim.player.maxHp,
            poisoned: sim.player.poisonEnd !== -1,
            xpFraction: Math.min(
                1,
                Math.max(0, (sim.xp - thisLevel) / Math.max(1, nextLevel - thisLevel)),
            ),
            seconds: Math.floor(sim.seconds),
            kills: sim.kills,
            coins: sim.coins,
            dps: this.shownDps,
            weaponDamage,
            otherDps: meter.otherPerSecond,
            buffs: getBuffViews(sim),
            boss,
            ability: this.getAbilityView(sim),
            quests: getQuestTrackViews(this.save, sim),
        };
        // What hasn't changed stays the same object, so a part of the HUD that shows
        // only that doesn't draw again
        const shownNumbers = this.store.getNumbers();
        const sharedNumbers = shareUnchanged(shownNumbers, numbers);
        if (force || sharedNumbers !== shownNumbers) {
            this.store.setNumbers(sharedNumbers);
        }
        const hud: HudView = {
            mapId: sim.map.id,
            round: sim.endless ? sim.round : undefined,
            level: sim.level,
            maxWeapons: sim.maxWeapons,
            maxPassives: sim.maxPassives,
            weapons: sim.weapons.map((w) => {
                const last = w.def.levels.length;
                const level = w.def.levels[Math.min(w.level, last) - 1];
                return {
                    id: w.def.id,
                    name: upgradedName(level.name ?? w.def.name, w.level - last),
                    level: w.level,
                    maxLevel: w.def.levels.length,
                    iconObjId: level.objId ?? w.def.iconObjId,
                    detail: w.bonus > 0 ? `${formatWeaponBonus(w.bonus)} damage` : "",
                    stats: weaponStats(w.def, level).map(formatWeaponStat),
                    evolution: getEvolutionView(sim, w),
                    rarityColor: RARITIES[w.def.rarity].color,
                };
            }),
            passives: sim.passives.map((p) => {
                const def = getPassive(p.id);
                return {
                    id: p.id,
                    name: upgradedName(def.name, p.level - def.maxLevel),
                    level: p.level,
                    maxLevel: def.maxLevel,
                    iconObjId: def.iconObjId,
                    iconSpriteId: def.iconSpriteId,
                    detail: formatPassiveValue(def, p.value),
                    rarityColor: RARITIES[def.rarity].color,
                };
            }),
            stats: formatStats(sim.stats),
            gear: getGearViews(sim),
            inventory: getInventoryViews(sim),
            rerolls: sim.rerollsLeft,
            banishes: sim.banishesLeft,
            locks: sim.locksLeft,
            skip: sim.canSkip
                ? { cost: sim.skipCost, affordable: sim.coins >= sim.skipCost }
                : undefined,
        };
        const previous = this.store.getSnapshot().hud;
        const shared = shareUnchanged(previous, hud);
        if (force || shared !== previous) {
            this.store.set({ hud: shared });
        }
        if (sim.heroes.length > 1) {
            const party = sim.heroes
                .filter((hero) => hero.index !== sim.focus)
                .map((hero) => ({
                    name: hero.name,
                    characterId: hero.characterId,
                    hp: Math.max(0, Math.round(hero.player.hp)),
                    maxHp: hero.player.maxHp,
                    down: hero.down,
                    left: hero.left,
                    revivable: sim.canBeRevived(hero),
                    reviveProgress: reviveProgress(hero),
                    immune: sim.isImmune(hero),
                    id: this.coopPlayerIds[hero.index],
                }));
            if (JSON.stringify(party) !== JSON.stringify(this.store.getSnapshot().party)) {
                this.store.set({ party });
            }
            const revive = getReviveView(sim);
            if (JSON.stringify(revive) !== JSON.stringify(this.store.getSnapshot().revive)) {
                this.store.set({ revive });
            }
        }
    }

    submitActors(actors: ActorRenderer, _camera: Camera): void {
        const sim = this.sim;
        if (sim) {
            this.view.submitActors(actors, sim, this.getAlpha());
            return;
        }
        // Title screen: just the character, and their pet
        const model = this.assets.getPlayer();
        const tick = Math.floor(this.attractTick);
        if (model) {
            const anim = model.getAnim(this.assets.getPlayerStance().idle);
            actors.draw(
                model,
                anim,
                anim.getFrame(tick),
                TITLE_MAP.spawn.x,
                this.grid.getHeight(TITLE_MAP.spawn.x, TITLE_MAP.spawn.y) / 128,
                TITLE_MAP.spawn.y,
                0,
            );
        }
        const pet = this.save.pet === undefined ? undefined : PET_BY_ID.get(this.save.pet);
        const petModel = pet && this.assets.getPet(pet.id);
        if (pet && petModel) {
            const anim = petModel.getAnim(pet.idleSeq);
            const x = TITLE_MAP.spawn.x + PREVIEW_PET_SIDE;
            const y = TITLE_MAP.spawn.y - PREVIEW_PET_BACK;
            actors.draw(
                petModel,
                anim,
                anim.getFrame(tick),
                x,
                this.grid.getHeight(x, y) / 128,
                y,
                0,
            );
        }
    }

    drawOverlay(camera: Camera): void {
        const overlay = this.overlay;
        overlay.begin(camera);
        const sim = this.sim;
        if (sim) {
            this.view.pickupTimers = this.display.pickupTimers;
            this.view.drawOverlay(overlay, sim, this.getAlpha());
            if (this.minimapCanvas) {
                this.minimap.draw(
                    this.minimapCanvas,
                    sim,
                    this.getAlpha(),
                    this.viewHero,
                    this.view.localPlayerPose,
                );
            }
        }
        if (this.store.getSnapshot().debug) {
            this.drawDebug(sim);
        }
    }

    private drawDebug(sim: Sim | undefined): void {
        const overlay = this.overlay;
        const ctx = overlay.ctx;
        const x = sim ? sim.player.x : TITLE_MAP.spawn.x;
        const y = sim ? sim.player.y : TITLE_MAP.spawn.y;
        this.drawCollisionDebug(Math.floor(x), Math.floor(y));
        ctx.font = "16px OSRS Small, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#ffff00";
        const alive = sim ? sim.enemies.filter((e) => !e.dead).length : 0;
        const timeLeft = sim ? Math.round(sim.timeLeftForBoss) : 0;
        ctx.fillText(
            `${this.fps.toFixed(0)} fps  enemies ${alive}  projectiles ${sim?.projectiles.length ?? 0}  ` +
                `pickups ${sim?.pickups.length ?? 0}  tile ${Math.floor(x)}, ${Math.floor(y)}  ` +
                `flags 0x${this.grid.getFlags(Math.floor(x), Math.floor(y)).toString(16)}  boss in ${timeLeft}s`,
            12,
            overlay.height - 12,
        );
    }

    private drawCollisionDebug(cx: number, cy: number): void {
        const overlay = this.overlay;
        const ctx = overlay.ctx;
        const grid = this.grid;
        const range = 14;

        const corner = (x: number, y: number) => {
            const height = grid.getHeight(x, y) / 128;
            const p = overlay.project(x, height, y, this.screen);
            return [p.x, p.y, p.visible ? 1 : 0];
        };
        const box = { x0: 0, y0: 0, x1: 0, y1: 0 };

        ctx.lineWidth = 2;
        for (let ty = cy - range; ty <= cy + range; ty++) {
            for (let tx = cx - range; tx <= cx + range; tx++) {
                const flags = grid.getFlags(tx, ty);
                if (flags === 0) {
                    continue;
                }
                const sw = corner(tx, ty);
                const se = corner(tx + 1, ty);
                const ne = corner(tx + 1, ty + 1);
                const nw = corner(tx, ty + 1);
                if (!sw[2] && !ne[2]) {
                    continue;
                }
                if (grid.isSolid(tx, ty)) {
                    ctx.fillStyle =
                        flags & CollisionFlag.FLOOR
                            ? "rgba(0, 120, 255, 0.35)"
                            : "rgba(255, 0, 0, 0.35)";
                    // Objects only block part of their tile
                    const { x0, y0, x1, y1 } = grid.getSolidBox(tx, ty, box);
                    const bsw = corner(x0, y0);
                    const bse = corner(x1, y0);
                    const bne = corner(x1, y1);
                    const bnw = corner(x0, y1);
                    ctx.beginPath();
                    ctx.moveTo(bsw[0], bsw[1]);
                    ctx.lineTo(bse[0], bse[1]);
                    ctx.lineTo(bne[0], bne[1]);
                    ctx.lineTo(bnw[0], bnw[1]);
                    ctx.closePath();
                    ctx.fill();
                    continue;
                }
                ctx.strokeStyle = "#ffff00";
                ctx.beginPath();
                if (flags & CollisionFlag.WALL_NORTH) {
                    ctx.moveTo(nw[0], nw[1]);
                    ctx.lineTo(ne[0], ne[1]);
                }
                if (flags & CollisionFlag.WALL_SOUTH) {
                    ctx.moveTo(sw[0], sw[1]);
                    ctx.lineTo(se[0], se[1]);
                }
                if (flags & CollisionFlag.WALL_EAST) {
                    ctx.moveTo(se[0], se[1]);
                    ctx.lineTo(ne[0], ne[1]);
                }
                if (flags & CollisionFlag.WALL_WEST) {
                    ctx.moveTo(sw[0], sw[1]);
                    ctx.lineTo(nw[0], nw[1]);
                }
                ctx.stroke();
            }
        }
    }
}

// "2 revives left"
function describeRevives(left: number): string {
    return `${left} ${left === 1 ? "revive" : "revives"} left`;
}

// How far along a downed hero's revive is, 0 to 1
function reviveProgress(hero: Hero): number {
    return hero.revive ? Math.min(1, hero.revive.ticks / (REVIVE_SECONDS * TICKS_PER_SECOND)) : 0;
}

// The revive this player's part of, if any: down and waiting for one, or
// reviving a teammate
function getReviveView(sim: Sim): ReviveView | undefined {
    const own = sim.heroes[sim.focus];
    if (sim.runOver || sim.state !== "playing") {
        return undefined;
    }
    if (sim.canBeRevived(own)) {
        const reviver = own.revive && sim.heroes[own.revive.hero];
        return {
            name: reviver?.name,
            reviving: false,
            progress: reviveProgress(own),
            revivesLeft: sim.revivesLeftFor(own),
        };
    }
    const downed = sim.heroes.find((hero) => hero.revive?.hero === sim.focus);
    if (downed) {
        return {
            name: downed.name,
            reviving: true,
            progress: reviveProgress(downed),
            revivesLeft: sim.revivesLeftFor(downed),
        };
    }
    return undefined;
}
