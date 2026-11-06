import { ShopUpgradeDef } from "./types";

// Permanent upgrades bought with banked coins, themed as skills.
export const SHOP_UPGRADES: ShopUpgradeDef[] = [
    {
        id: "strength",
        name: "Strength",
        description: "+5% damage",
        stat: "might",
        perRank: 0.05,
        maxRank: 5,
        baseCost: 200,
    },
    {
        id: "defence",
        name: "Defence",
        description: "Take 1 less damage",
        stat: "armor",
        perRank: 1,
        maxRank: 3,
        baseCost: 600,
    },
    {
        id: "hitpoints",
        name: "Hitpoints",
        // A fifth of the player's 25 base hitpoints a rank
        description: "+5 max hitpoints",
        stat: "maxHp",
        perRank: 0.2,
        maxRank: 5,
        baseCost: 200,
    },
    {
        id: "prayer",
        name: "Prayer",
        description: "Heal 1.5 hitpoints a minute",
        stat: "regen",
        perRank: 1.5,
        maxRank: 5,
        baseCost: 200,
    },
    {
        id: "attack",
        name: "Attack",
        description: "Weapons 2.5% faster",
        stat: "cooldown",
        perRank: 0.025,
        maxRank: 2,
        baseCost: 900,
    },
    {
        id: "magic",
        name: "Magic",
        description: "+5% area",
        stat: "area",
        perRank: 0.05,
        maxRank: 2,
        baseCost: 300,
    },
    {
        id: "ranged",
        name: "Ranged",
        description: "+10% projectile speed",
        stat: "speed",
        perRank: 0.1,
        maxRank: 2,
        baseCost: 300,
    },
    {
        id: "herblore",
        name: "Herblore",
        description: "+15% effect duration",
        stat: "duration",
        perRank: 0.15,
        maxRank: 2,
        baseCost: 300,
    },
    {
        id: "fletching",
        name: "Fletching",
        description: "One more projectile",
        stat: "amount",
        perRank: 1,
        maxRank: 1,
        baseCost: 5000,
    },
    {
        id: "agility",
        name: "Agility",
        description: "+5% movement speed",
        stat: "moveSpeed",
        perRank: 0.05,
        maxRank: 2,
        baseCost: 300,
    },
    {
        id: "thieving",
        name: "Thieving",
        description: "+25% pickup range",
        stat: "magnet",
        perRank: 0.25,
        maxRank: 2,
        baseCost: 300,
    },
    {
        id: "slayer",
        name: "Slayer",
        description: "+10% luck",
        stat: "luck",
        perRank: 0.1,
        maxRank: 3,
        baseCost: 600,
    },
    {
        id: "farming",
        name: "Farming",
        description: "+3% experience",
        stat: "growth",
        perRank: 0.03,
        maxRank: 5,
        baseCost: 900,
    },
    {
        id: "mining",
        name: "Mining",
        description: "+10% coins",
        stat: "greed",
        perRank: 0.1,
        maxRank: 5,
        baseCost: 200,
    },
    {
        id: "hunter",
        name: "Hunter",
        description: "One more reroll a run",
        stat: "reroll",
        perRank: 1,
        maxRank: 3,
        baseCost: 500,
    },
    {
        // Burning what you don't want: a level up's weapon or passive, or a
        // casket's item, never offered again this run
        id: "firemaking",
        name: "Firemaking",
        description: "Banish one weapon, passive or item a run",
        stat: "banish",
        perRank: 1,
        maxRank: 3,
        // A little dearer than Hunter's reroll
        baseCost: 600,
    },
    {
        // Set sail: holds a level up reward over to the next level up, where it
        // comes first as it was
        id: "sailing",
        name: "Sailing",
        description: "Set sail: lock a level up reward for your next level up",
        stat: "lock",
        perRank: 1,
        maxRank: 2,
        baseCost: 800,
    },
    {
        id: "ring_of_life",
        name: "Ring of life",
        description: "Get back up once when you die",
        stat: "revival",
        perRank: 1,
        maxRank: 1,
        baseCost: 10000,
    },
    {
        id: "woodcutting",
        name: "Woodcutting",
        description: "+15% melee knockback",
        stat: "meleeKnockback",
        perRank: 0.15,
        maxRank: 3,
        baseCost: 400,
    },
    {
        id: "smithing",
        name: "Smithing",
        description: "One more weapon slot",
        stat: "weaponSlots",
        perRank: 1,
        maxRank: 2,
        baseCost: 10000,
    },
    {
        id: "crafting",
        name: "Crafting",
        description: "One more passive slot",
        stat: "passiveSlots",
        perRank: 1,
        maxRank: 2,
        baseCost: 7500,
    },
    {
        id: "runecraft",
        name: "Runecraft",
        description: "+15% power-up drops",
        stat: "powerUpRate",
        perRank: 0.15,
        maxRank: 3,
        baseCost: 800,
    },
];

export const SHOP_UPGRADE_BY_ID: Map<string, ShopUpgradeDef> = new Map(
    SHOP_UPGRADES.map((u) => [u.id, u]),
);

// What a page with these ranks costs in all. It goes only by the ranks, so
// buying them in any order costs the same. Each rank of a skill costs more
// than the last, and every rank on the page makes all of them a bit dearer.
export function getPageCost(upgrades: Record<string, number>): number {
    let base = 0;
    let ranks = 0;
    for (const [id, rank] of Object.entries(upgrades)) {
        const upgrade = SHOP_UPGRADE_BY_ID.get(id);
        if (!upgrade) {
            continue;
        }
        // Its ranks at base price: baseCost, then twice that, and so on
        base += (upgrade.baseCost * rank * (rank + 1)) / 2;
        ranks += rank;
    }
    return ranks === 0 ? 0 : Math.round(base * (1 + 0.05 * (ranks - 1)));
}

// The price of one more rank of a skill: what it adds to the page's cost
export function getUpgradeCost(upgradeId: string, upgrades: Record<string, number>): number {
    const more = { ...upgrades, [upgradeId]: (upgrades[upgradeId] ?? 0) + 1 };
    return getPageCost(more) - getPageCost(upgrades);
}

export type UpgradeRequirement = { upgradeId: string; name: string; rank: number };

// What a locked upgrade still waits on: the upgrades not yet at their rank.
// Empty when it's open to buy. Only the page's ranks decide it.
export function getUpgradeRequirements(
    upgradeId: string,
    upgrades: Record<string, number>,
): UpgradeRequirement[] {
    const requires = SHOP_UPGRADE_BY_ID.get(upgradeId)?.requires ?? [];
    return requires
        .filter((need) => (upgrades[need.upgradeId] ?? 0) < need.rank)
        .map((need) => ({
            ...need,
            name: SHOP_UPGRADE_BY_ID.get(need.upgradeId)?.name ?? need.upgradeId,
        }));
}

export function isUpgradeLocked(upgradeId: string, upgrades: Record<string, number>): boolean {
    return getUpgradeRequirements(upgradeId, upgrades).length > 0;
}

export type ShopListing = {
    upgrade: ShopUpgradeDef;
    rank: number;
    // Waiting on other upgrades, which are requiredBy's
    locked: boolean;
    requiredBy: UpgradeRequirement[];
};

// Every upgrade for a page's ranks, in shop order, with which are still locked
export function getShopUpgrades(upgrades: Record<string, number>): ShopListing[] {
    return SHOP_UPGRADES.map((upgrade) => {
        const requiredBy = getUpgradeRequirements(upgrade.id, upgrades);
        return {
            upgrade,
            rank: upgrades[upgrade.id] ?? 0,
            locked: requiredBy.length > 0,
            requiredBy,
        };
    });
}
