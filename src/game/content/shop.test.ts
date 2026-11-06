import { describe, expect, test } from "vitest";

import { buyUpgrade, createSave, getMetaStats, getNextUpgradeCost } from "../core/save";
import {
    SHOP_UPGRADES,
    SHOP_UPGRADE_BY_ID,
    getPageCost,
    getShopUpgrades,
    getUpgradeCost,
    getUpgradeRequirements,
    isUpgradeLocked,
} from "./shop";
import { STAT_INFO } from "./stats";

function maxed(...ids: string[]): Record<string, number> {
    return Object.fromEntries(ids.map((id) => [id, SHOP_UPGRADE_BY_ID.get(id)!.maxRank]));
}

describe("shop", () => {
    test("every requirement is a real upgrade, wanted at a rank it has", () => {
        for (const upgrade of SHOP_UPGRADES) {
            for (const need of upgrade.requires ?? []) {
                const required = SHOP_UPGRADE_BY_ID.get(need.upgradeId);
                expect(required, upgrade.id).toBeDefined();
                expect(need.rank).toBeLessThanOrEqual(required!.maxRank);
            }
        }
    });

    test("Sailing's Set sail is the one upgrade that locks a reward, with no gate", () => {
        expect(STAT_INFO.lock.label).toBe("locks");
        const upgrade = SHOP_UPGRADE_BY_ID.get("sailing")!;
        expect(upgrade.stat).toBe("lock");
        expect(upgrade.perRank).toBe(1);
        expect(upgrade.maxRank).toBe(2);
        expect(upgrade.description).toContain("Set sail");
        expect(upgrade.requires).toBeUndefined();
        expect(SHOP_UPGRADES.filter((u) => u.stat === "lock")).toEqual([upgrade]);
        expect(SHOP_UPGRADE_BY_ID.has("hunter_lock")).toBe(false);
        expect(SHOP_UPGRADE_BY_ID.has("firemaking_lock")).toBe(false);
        expect(isUpgradeLocked("sailing", {})).toBe(false);
        expect(getUpgradeRequirements("sailing", {})).toEqual([]);
    });

    test("the listing says which are locked and what they need", () => {
        expect(getShopUpgrades({}).map((entry) => entry.upgrade)).toEqual(SHOP_UPGRADES);
        for (const entry of getShopUpgrades(maxed("hunter"))) {
            expect(entry.locked).toBe(false);
            expect(entry.requiredBy).toEqual([]);
        }
        expect(getShopUpgrades(maxed("hunter")).find((e) => e.upgrade.id === "hunter")!.rank).toBe(
            3,
        );
    });

    test("prices go by the page's ranks only, in any order", () => {
        const page = { ...maxed("hunter", "firemaking"), sailing: 1 };
        const reversed = Object.fromEntries(Object.entries(page).reverse());
        expect(getPageCost(page)).toBe(getPageCost(reversed));
        expect(getUpgradeCost("sailing", {})).toBeGreaterThan(0);
    });

    test("Sailing can be bought up to two ranks, one lock each", () => {
        const save = createSave();
        save.coins = 1e7;
        expect(getMetaStats(save).lock).toBe(0);
        expect(buyUpgrade(save, "sailing")).toBe(true);
        expect(getMetaStats(save).lock).toBe(1);
        expect(buyUpgrade(save, "sailing")).toBe(true);
        expect(getMetaStats(save).lock).toBe(2);
        expect(buyUpgrade(save, "sailing")).toBe(false);
        // Each combat style's page is its own
        expect(getMetaStats(save, "ranged").lock).toBe(0);
    });
});
