import { STAT_INFO } from "./stats";
import { StatKey } from "./types";

// An OSRS cache icon: an item (objId) or an interface sprite (spriteId), never both
export type StatIconRef = { objId?: number; spriteId?: number };

const sprite = (spriteId: number): StatIconRef => ({ spriteId });
const obj = (objId: number): StatIconRef => ({ objId });

// The skill tab's icons
const ATTACK = sprite(197); // Attack
const STRENGTH = sprite(198); // Strength
const DEFENCE = sprite(199); // Defence
const RANGED = sprite(200); // Ranged
const MAGIC = sprite(202); // Magic
const HITPOINTS = sprite(203); // Hitpoints

const STOPWATCH = obj(27414); // Giant stopwatch
const HOURGLASS = obj(5610); // Hourglass
const AREA = obj(9977); // Red chinchompa
const ARROWS = obj(892); // Rune arrow
const DART = obj(811); // Rune dart
const JAVELIN = obj(830); // Rune javelin
const SCIMITAR = obj(1333); // Rune scimitar
const VENOM = obj(12934); // Zulrah's scales

// Labels as the player reads them (lower case, without the number or sign in front),
// from STAT_INFO, weaponStats and the passives' effects
const ICONS: Record<string, StatIconRef> = {
    // STAT_INFO
    damage: STRENGTH,
    "melee damage": ATTACK,
    "ranged damage": RANGED,
    "magic damage": MAGIC,
    "damage to bosses": obj(22978), // Dragon hunter lance
    "damage a level": STRENGTH,
    armour: DEFENCE,
    "max hitpoints": HITPOINTS,
    "hitpoints a minute": obj(385), // Shark
    "weapon speed": STOPWATCH,
    area: AREA,
    "aura area": obj(4675), // Ancient staff
    "projectile speed": DART,
    "effect duration": HOURGLASS,
    projectiles: ARROWS,
    "movement speed": obj(88), // Boots of lightness
    "pickup range": obj(11941), // Looting bag
    luck: obj(28181), // Clover insignia
    experience: obj(2528), // Lamp
    coins: obj(995), // Coins
    revivals: obj(2570), // Ring of life
    rerolls: obj(562), // Chaos rune
    banishes: obj(560), // Death rune
    locks: obj(12791), // Rune pouch
    "recoil damage": obj(2550), // Ring of recoil
    "chance to heal on hit": obj(11090), // Phoenix necklace
    "melee knockback": obj(1347), // Rune warhammer
    "weapon slots": SCIMITAR,
    "passive slots": obj(8850), // Rune defender
    "power-up drops": obj(13393), // Xeric's talisman

    // weaponStats
    attacks: STOPWATCH,
    sides: ATTACK,
    reach: SCIMITAR,
    arc: SCIMITAR,
    knockback: obj(1347), // Rune warhammer
    targets: MAGIC,
    pierces: JAVELIN,
    bounces: obj(868), // Rune knife
    splash: AREA,
    radius: AREA,
    "blast radius": AREA,
    venom: VENOM,
    "venom lasts": HOURGLASS,
    speed: DART,
    "spin speed": DART,
    lasts: HOURGLASS,
    "freezes for": HOURGLASS,
    "burns for": HOURGLASS,
    "weakens for": HOURGLASS,
};

// Longest first, so "ranged damage" wins over "damage"
const LABELS = Object.keys(ICONS).sort((a, b) => b.length - a.length);

// "+24% ranged damage" -> "ranged damage", "Damage 10 → 13" -> "damage 10 → 13"
function stripLead(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/^[+\-−]?\s*\d+(\.\d+)?%?\s*/, "");
}

// The icon for a stat by its key, for a menu that knows which stat it's showing
export function statKeyIcon(key: StatKey): StatIconRef | undefined {
    return statIconFor(STAT_INFO[key].label);
}

// The icon for a stat line as shown to the player, by the label it starts with.
// undefined when it isn't a stat.
export function statIconFor(text: string): StatIconRef | undefined {
    const rest = stripLead(text);
    for (const label of LABELS) {
        if (rest.startsWith(label) && !/[a-z]/.test(rest[label.length] ?? "")) {
            return { ...ICONS[label] };
        }
    }
    return undefined;
}

// The padlock beside a level up reward that can be locked, or is (sprite 1342: 29x22,
// the bank placeholder toggle's locked padlock icon)
export const LOCK_SPRITE = 1342;

// Everything above that the slim cache has to keep: the item icons and the interface
// sprites, which it keeps only if the game's lists name them
export const STAT_ICON_OBJ_IDS: number[] = [
    ...new Set(
        Object.values(ICONS).flatMap((icon) => (icon.objId !== undefined ? [icon.objId] : [])),
    ),
];
export const STAT_ICON_SPRITE_IDS: number[] = [
    ...new Set([
        LOCK_SPRITE,
        ...Object.values(ICONS).flatMap((icon) =>
            icon.spriteId !== undefined ? [icon.spriteId] : [],
        ),
    ]),
];
