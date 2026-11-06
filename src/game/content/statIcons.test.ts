import { PASSIVES, formatPassiveValue } from "./passives";
import { StatIconRef, statIconFor, statKeyIcon } from "./statIcons";
import { STAT_INFO, formatStat } from "./stats";
import { StatKey } from "./types";
import { formatWeaponBonus, formatWeaponStat, weaponStatChanges, weaponStats } from "./weaponStats";
import { WEAPONS } from "./weapons";

function expectOneIcon(text: string, icon: StatIconRef | undefined) {
    expect(icon, text).toBeDefined();
    expect(Number(icon?.objId !== undefined) + Number(icon?.spriteId !== undefined), text).toBe(1);
}

describe("stat icons", () => {
    test("every stat label resolves, positive or negative", () => {
        for (const key of Object.keys(STAT_INFO) as StatKey[]) {
            for (const value of [0.1, 2, -1]) {
                const text = formatStat(key, value);
                expectOneIcon(text, statIconFor(text));
            }
        }
    });

    test("every stat line of every weapon resolves", () => {
        for (const def of WEAPONS) {
            for (let i = 0; i < def.levels.length; i++) {
                const level = def.levels[i];
                const lines = weaponStats(def, level).map(formatWeaponStat);
                if (i > 0) {
                    lines.push(
                        ...weaponStatChanges(def, def.levels[i - 1], level).map(formatWeaponStat),
                    );
                }
                for (const text of lines) {
                    expectOneIcon(`${def.id}: ${text}`, statIconFor(text));
                }
            }
        }
    });

    test("passive details and weapon bonuses resolve", () => {
        for (const passive of PASSIVES) {
            const text = formatPassiveValue(passive, passive.perLevel);
            expectOneIcon(text, statIconFor(text));
        }
        expectOneIcon("bonus", statIconFor(`${formatWeaponBonus(0.15)} damage`));
    });

    test("the most specific label wins", () => {
        expect(statIconFor("+24% ranged damage")).toEqual(statIconFor("Ranged damage"));
        expect(statIconFor("+24% ranged damage")).not.toEqual(statIconFor("+24% damage"));
        expect(statIconFor("+10% damage to bosses")).not.toEqual(statIconFor("+10% damage"));
        expect(statIconFor("+34% luck")).toEqual({ objId: 28181 });
        expect(statIconFor("+5% coins")).toEqual({ objId: 995 });
    });

    test("a stat's key gives its icon, whatever the wording around it", () => {
        for (const key of Object.keys(STAT_INFO) as StatKey[]) {
            expectOneIcon(key, statKeyIcon(key));
        }
        expect(statKeyIcon("armor")).toEqual(statIconFor("+1 armour"));
    });

    test("anything else has no icon", () => {
        expect(statIconFor("")).toBeUndefined();
        expect(statIconFor("Rune scimitar")).toBeUndefined();
        expect(statIconFor("+5% luckiness")).toBeUndefined();
        expect(statIconFor("12")).toBeUndefined();
    });
});
