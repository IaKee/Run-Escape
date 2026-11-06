// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import {
    ChestView,
    ChoiceView,
    EventView,
    GameStore,
    HudNumbers,
    HudView,
    SlotView,
} from "../client/GameStore";
import { CombatStyle } from "../content/types";
import { buyUpgrade, createSave, refundUpgrade, refundUpgrades } from "../core/save";
import { ChestModal } from "./ChestModal";
import { EventModal } from "./EventModal";
import { GameUi } from "./GameUi";

const device = vi.hoisted(() => ({ coarse: false }));

vi.mock("../../util/DeviceUtil", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../util/DeviceUtil")>()),
    get isCoarsePointer() {
        return device.coarse;
    },
}));

afterEach(() => {
    cleanup();
    device.coarse = false;
});

function renderShop(upgrades: Record<string, number>, coins = 0, characterId = "warrior") {
    const save = createSave();
    save.coins = 1000000;
    for (const [id, ranks] of Object.entries(upgrades)) {
        for (let rank = 0; rank < ranks; rank++) {
            expect(buyUpgrade(save, id)).toBe(true);
        }
    }
    save.coins = coins;
    const store = new GameStore(save);
    store.set({ screen: "shop", characterId });
    const refresh = () => store.set({ save: { ...save } });
    const actions = {
        buyUpgrade: vi.fn((id: string, style: CombatStyle) => {
            buyUpgrade(save, id, style);
            refresh();
        }),
        refundUpgrade: vi.fn((id: string, style: CombatStyle) => {
            refundUpgrade(save, id, style);
            refresh();
        }),
        refundUpgrades: vi.fn((style: CombatStyle) => {
            refundUpgrades(save, style);
            refresh();
        }),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={actions as unknown as GameClient} />);
    return { ...actions, save };
}

test("skills explain how combat-style presets are used", () => {
    renderShop({});
    expect(screen.getByRole("tablist", { name: "Skill presets" })).toBeInTheDocument();
    expect(
        screen.getByText(
            "Melee, Ranged and Magic are separate skill presets, used automatically by adventurers of that combat style.",
        ),
    ).toBeVisible();
});

test("switching class pages keeps purchases and single-rank refunds isolated", () => {
    expect.hasAssertions();
    const actions = renderShop({}, 50000);
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    const melee = structuredClone(actions.save.skillPages.melee);
    fireEvent.click(screen.getByRole("tab", { name: "Ranged preset" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Ranged preset");
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    const ranged = structuredClone(actions.save.skillPages.ranged);
    fireEvent.click(screen.getByRole("tab", { name: "Magic preset" }));
    expect(screen.getByRole("button", { name: "Refund all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Strength\b/ }));
    expect(actions.refundUpgrade).toHaveBeenLastCalledWith("strength", "magic");
    expect(actions.save.skillPages.magic.upgrades).toEqual({});
    expect(actions.save.skillPages.melee).toEqual(melee);
    expect(actions.save.skillPages.ranged).toEqual(ranged);
    fireEvent.click(screen.getByRole("tab", { name: "Ranged preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Refund all" }));
    expect(actions.refundUpgrades).toHaveBeenLastCalledWith("ranged");
    expect(actions.save.skillPages.melee).toEqual(melee);
    fireEvent.click(screen.getByRole("tab", { name: "Melee preset" }));
    expect(screen.getByRole("button", { name: "Refund all" })).toBeEnabled();
}, 30000);

test("each page can afford the full gold budget after another class spends it", () => {
    expect.hasAssertions();
    const actions = renderShop({}, 10000);
    for (const label of ["Melee preset", "Ranged preset", "Magic preset"]) {
        fireEvent.click(screen.getByRole("tab", { name: label }));
        const card = screen.getByRole("button", { name: /^Ring of life\b/ });
        expect(card).not.toHaveClass("ui-card-dim");
        expect(document.querySelector(".ui-shop > .ui-row:last-child .ui-coins")).toHaveTextContent(
            "10",
        );
        fireEvent.click(card);
        expect(actions.save.coins).toBe(0);
    }
    for (const page of Object.values(actions.save.skillPages)) {
        expect(page.upgrades.ring_of_life).toBe(1);
        expect(page.upgradesSpent).toBe(10000);
    }
}, 30000);

test.each([
    ["warrior", "Melee preset"],
    ["ranger", "Ranged preset"],
    ["wizard", "Magic preset"],
])("skills open on %s's class page", (characterId, label) => {
    expect.hasAssertions();
    renderShop({}, 0, characterId);
    expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
});

test("class tabs support arrow keys and wrap without changing any skill pages", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 }, 50000);
    const before = structuredClone(actions.save);
    const melee = screen.getByRole("tab", { name: "Melee preset" });
    melee.focus();
    fireEvent.keyDown(melee, { key: "ArrowLeft" });
    const magic = screen.getByRole("tab", { name: "Magic preset" });
    expect(magic).toHaveFocus();
    expect(magic).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(magic, { key: "ArrowRight" });
    expect(melee).toHaveFocus();
    expect(actions.save).toEqual(before);
});

test("right-clicking a bought skill refunds one rank even without coins", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2, hitpoints: 1 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(actions.refundUpgrades).not.toHaveBeenCalled();
});

test("maxed skills still accept right-clicks but cannot buy another rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 5 }, 50000);
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveTextContent("Maxed");
    fireEvent.click(card);
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
});

test("right-clicking an unbought skill does not refund or purchase it", () => {
    expect.hasAssertions();
    const actions = renderShop({});
    expect(fireEvent.contextMenu(screen.getByRole("button", { name: /^Strength\b/ }))).toBe(true);
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("left-clicking still buys a rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 }, 50000);
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    expect(actions.buyUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
});

test("the visible refund button refunds one bought rank without purchasing", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2 });
    const refund = screen.getByRole("button", { name: "Refund one Strength rank" });
    expect(refund).toHaveAttribute("title", "Refund one Strength rank");
    expect(refund.closest(".ui-shop-card")).toBeNull();
    fireEvent.click(refund);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(actions.refundUpgrades).not.toHaveBeenCalled();
});

test("maxed skills retain their visible refund button", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("unbought skills have no refund button", () => {
    expect.hasAssertions();
    renderShop({});
    expect(screen.queryByRole("button", { name: "Refund one Strength rank" })).toBeNull();
});

test("Refund all clears ranks that have no spending recorded", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2 });
    actions.save.skillPages.melee.upgradesSpent = 0;
    fireEvent.click(screen.getByRole("tab", { name: "Ranged preset" }));
    fireEvent.click(screen.getByRole("tab", { name: "Melee preset" }));
    fireEvent.click(screen.getByRole("button", { name: "Refund all" }));
    expect(actions.refundUpgrades).toHaveBeenCalledExactlyOnceWith("melee");
    expect(actions.save.skillPages.melee.upgrades).toEqual({});
    expect(screen.queryByRole("button", { name: "Refund one Strength rank" })).toBeNull();
});

test("touch long presses do not refund, but the refund button still works", () => {
    expect.hasAssertions();
    device.coarse = true;
    const actions = renderShop({ strength: 2 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("bought cards expose the desktop right-click shortcut in a tooltip", () => {
    expect.hasAssertions();
    renderShop({ strength: 1 });
    expect(screen.getByRole("button", { name: /^Strength\b/ })).toHaveAttribute(
        "title",
        "Right-click to refund one rank",
    );
});

test("unaffordable skills cannot purchase but can refund a bought rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(card).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(card);
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
});

function renderMaps(mapId = "lumbridge") {
    const store = new GameStore(createSave());
    store.set({ screen: "characters", mapId });
    const actions = {
        selectMap: vi.fn((id: string) => store.set({ mapId: id })),
        selectCharacter: vi.fn(),
        toggleFavouriteCharacter: vi.fn(),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={actions as unknown as GameClient} />);
    return actions;
}

test("the map screen opens on the picked map's tab, and a map on another tab can be picked", () => {
    expect.hasAssertions();
    const actions = renderMaps();
    expect(screen.getByRole("tab", { name: "Campaign" })).toHaveAttribute("aria-selected", "true");
    // The other tabs' maps are laid out, but out of reach
    expect(screen.getByRole("button", { name: "Lumbridge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Theatre of Blood" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Bosses" }));
    expect(screen.queryByRole("button", { name: "Lumbridge" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Theatre of Blood" }));
    expect(actions.selectMap).toHaveBeenCalledExactlyOnceWith("theatre_of_blood");
    expect(screen.getByRole("button", { name: /Enter Theatre of Blood/ })).toBeInTheDocument();
    cleanup();
    renderMaps("theatre_of_blood");
    expect(screen.getByRole("tab", { name: "Bosses" })).toHaveAttribute("aria-selected", "true");
}, 30000);

test("the favourite button is the shown adventurer's, and stays as focus moves to it", () => {
    expect.hasAssertions();
    const actions = renderMaps();
    const shown = () =>
        document.querySelector(".ui-select-adventurers .ui-card-title")?.textContent;
    // Focus on an adventurer who isn't the one picked shows theirs
    const ranger = screen.getByRole("button", { name: "Ranger" });
    fireEvent.focus(ranger);
    expect(shown()).toBe("Ranger");
    const favourite = screen.getByRole("button", { name: "Make favourite" });
    // Going on to their button keeps them, and the button with them
    fireEvent.focusOut(ranger, { relatedTarget: favourite });
    expect(shown()).toBe("Ranger");
    expect(favourite).toBeInTheDocument();
    fireEvent.click(favourite);
    expect(actions.toggleFavouriteCharacter).toHaveBeenCalledExactlyOnceWith("ranger");
    // Leaving the panel goes back to the one picked
    fireEvent.focusOut(favourite, { relatedTarget: screen.getByRole("tab", { name: "Campaign" }) });
    expect(shown()).toBe("Warrior");
    // None for one who isn't open yet
    fireEvent.focus(document.querySelector(".ui-select-adventurers .ui-card-locked")!);
    expect(screen.queryByRole("button", { name: "Make favourite" })).toBeNull();
});

test("a map's own adventurer has no favourite button", () => {
    expect.hasAssertions();
    renderMaps("falador");
    expect(document.querySelector(".ui-select-adventurers .ui-card-title")?.textContent).toBe(
        "Durial321",
    );
    expect(screen.queryByRole("button", { name: "Make favourite" })).toBeNull();
});

test("map tabs support arrow keys and wrap", () => {
    expect.hasAssertions();
    renderMaps();
    const campaign = screen.getByRole("tab", { name: "Campaign" });
    campaign.focus();
    fireEvent.keyDown(campaign, { key: "ArrowRight" });
    const bosses = screen.getByRole("tab", { name: "Bosses" });
    expect(bosses).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Bosses");
    fireEvent.keyDown(bosses, { key: "ArrowLeft" });
    fireEvent.keyDown(campaign, { key: "ArrowLeft" });
    expect(screen.getAllByRole("tab").at(-1)).toHaveFocus();
});

function renderTitle(runs: number, lastExported?: number) {
    const save = { ...createSave(), runs, lastExported };
    const store = new GameStore(save);
    store.set({ screen: "title" });
    const client = {
        // Stands in for GameClient once the file's kept: the stamp and the save's write are
        // GameClient.test.ts's to check, and this only that the bar goes by the store's save
        exportSave: vi.fn(() => {
            store.set({ save: { ...store.getSnapshot().save, lastExported: Date.now() } });
        }),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={client as unknown as GameClient} />);
    return { client, store };
}

describe("the title's export reminder", () => {
    // Its own, as Node 25 and later have a localStorage that hides jsdom's
    beforeEach(() => {
        const items = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => void items.set(key, value),
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    test("isn't there for a new player, or once the save's been exported today", () => {
        expect.hasAssertions();
        renderTitle(0);
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
        cleanup();
        renderTitle(4, Date.now());
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
    });

    test("exports, and then goes", () => {
        expect.hasAssertions();
        const { client } = renderTitle(4);
        fireEvent.click(screen.getByRole("button", { name: "Export save" }));
        expect(client.exportSave).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
    });

    test("put off, it stays gone for the day, here and after a reload", () => {
        expect.hasAssertions();
        const { client } = renderTitle(4, Date.now() - 3 * 24 * 60 * 60 * 1000);
        expect(screen.getByText(/^Last exported/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Not today" }));
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
        expect(client.exportSave).not.toHaveBeenCalled();
        cleanup();
        renderTitle(4);
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
    });

    test("waits while the game isn't saving", () => {
        expect.hasAssertions();
        const { store } = renderTitle(4);
        expect(screen.getByRole("button", { name: "Export save" })).toBeInTheDocument();
        act(() => store.set({ saveBlock: { kind: "otherTab" }, saveBlockClosed: true }));
        expect(screen.queryByRole("button", { name: "Export save" })).toBeNull();
    });
});

describe("gear slot tooltips and stat icons", () => {
    function createRunHud(): HudView {
        return {
            mapId: "lumbridge",
            level: 3,
            maxWeapons: 6,
            maxPassives: 6,
            weapons: [
                {
                    id: "bow",
                    name: "Shortbow",
                    level: 2,
                    maxLevel: 8,
                    iconObjId: 841,
                    detail: "Rapid fire",
                    stats: ["Damage 13", "Attacks 1.67/s"],
                    rarityColor: "#fff",
                },
            ],
            passives: [],
            stats: ["+10% movement speed", "+1 armour"],
            gear: [
                {
                    slot: "head",
                    name: "Head",
                    item: {
                        id: "helm",
                        name: "Void helm",
                        objId: 11665,
                        rarity: { name: "Rare", color: "rgb(1, 2, 3)" },
                        kindLabel: "Head slot",
                        lines: ["+5% damage", "+1 armour"],
                        set: { text: "Void knight 1/4", active: false },
                    },
                },
                { slot: "cape", name: "Cape", item: undefined },
            ],
            inventory: [null, null, null, null],
            rerolls: 0,
            banishes: 0,
        };
    }

    function createNumbers(): HudNumbers {
        return {
            bossIn: 600,
            hp: 20,
            maxHp: 25,
            poisoned: false,
            xpFraction: 0.5,
            seconds: 61,
            kills: 7,
            coins: 3,
            dps: 0,
            weaponDamage: {},
            otherDps: 0,
            buffs: [],
            quests: [],
        };
    }

    function renderRun(hud: HudView, overlay: "none" | "paused" = "none") {
        const store = new GameStore(createSave());
        const noop = () => {};
        const client = new Proxy(
            { store, input: { stick: {} } },
            { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop) },
        ) as unknown as GameClient;
        store.set({ screen: "run", overlay, hud });
        store.setNumbers(createNumbers());
        const view = render(<GameUi store={store} client={client} />);
        return { store, view, client };
    }

    test("gear slots have no native title attribute", () => {
        const { view } = renderRun(createRunHud());
        const slots = view.container.querySelectorAll(".ui-gear-slot");
        expect(slots.length).toBe(2);
        slots.forEach((s) => {
            expect(s.getAttribute("title")).toBeNull();
        });
    });

    test("hovering an equipped gear slot shows ItemTooltip with StatLines", () => {
        const { view } = renderRun(createRunHud());
        const slot = view.container.querySelectorAll(".ui-gear-slot")[0];

        fireEvent.pointerEnter(slot, { pointerType: "mouse" });
        const tipId = slot.getAttribute("aria-describedby");
        expect(tipId).toBeTruthy();

        const tip = document.getElementById(tipId!);
        expect(tip).not.toBeNull();
        expect(tip?.textContent).toContain("Void helm");
        expect(tip?.textContent).toContain("Head slot");
        expect(tip?.textContent).toContain("+5% damage");
        expect(tip?.textContent).toContain("+1 armour");
        expect(tip?.querySelectorAll(".ui-stat-line").length).toBe(2);

        fireEvent.pointerLeave(slot, { pointerType: "mouse" });
        expect(document.getElementById(tipId!)).toBeNull();
    });

    test("hovering an empty gear slot shows '<Slot name> slot (empty)'", () => {
        const { view } = renderRun(createRunHud());
        const emptySlot = view.container.querySelectorAll(".ui-gear-slot")[1];

        fireEvent.pointerEnter(emptySlot, { pointerType: "mouse" });
        const tipId = emptySlot.getAttribute("aria-describedby");
        expect(tipId).toBeTruthy();

        const tip = document.getElementById(tipId!);
        expect(tip).not.toBeNull();
        expect(tip?.textContent).toBe("Cape slot (empty)");

        fireEvent.pointerLeave(emptySlot, { pointerType: "mouse" });
        expect(document.getElementById(tipId!)).toBeNull();
    });

    test("keyboard focus and Escape key toggle gear tooltip", () => {
        const { view } = renderRun(createRunHud());
        const slot = view.container.querySelectorAll(".ui-gear-slot")[0];

        fireEvent.focus(slot);
        const tipId = slot.getAttribute("aria-describedby");
        expect(tipId).toBeTruthy();
        expect(document.getElementById(tipId!)).not.toBeNull();

        fireEvent.keyDown(slot, { key: "Escape" });
        expect(slot.getAttribute("aria-describedby")).toBeNull();
        expect(document.getElementById(tipId!)).toBeNull();
    });

    test("weapon and passive slot tips render stat lines with StatLine", () => {
        const { view } = renderRun(createRunHud());
        const weaponTip = view.container.querySelector(".ui-slot-tip");
        expect(weaponTip).not.toBeNull();

        const statLines = weaponTip?.querySelectorAll(".ui-stat-line");
        expect(statLines?.length).toBe(2);
        expect(statLines?.[0]?.textContent).toBe("Damage 13");
        expect(statLines?.[0]?.querySelector(".ui-icon")).not.toBeNull();
        expect(statLines?.[1]?.textContent).toBe("Attacks 1.67/s");
        expect(statLines?.[1]?.querySelector(".ui-icon")).not.toBeNull();
    });

    test("PauseModal renders stats, weapon details and worn equipment with StatLine", () => {
        const { view } = renderRun(createRunHud(), "paused");
        const pause = view.container.querySelector(".ui-pause");
        expect(pause).not.toBeNull();

        // Player stats use StatLine
        const playerStats = pause?.querySelectorAll(".ui-pause-stats .ui-stat-line");
        expect(playerStats?.length).toBe(2);
        expect(playerStats?.[0]?.textContent).toBe("+10% movement speed");
        expect(playerStats?.[0]?.querySelector(".ui-icon")).not.toBeNull();
        expect(playerStats?.[1]?.textContent).toBe("+1 armour");
        expect(playerStats?.[1]?.querySelector(".ui-icon")).not.toBeNull();

        // Weapon/passive details use StatLine
        const weaponDetails = pause?.querySelectorAll(".ui-pause-detail .ui-stat-line");
        expect(weaponDetails && weaponDetails.length > 0).toBe(true);

        // Worn equipment lines use StatLine
        expect(pause?.textContent).toContain("Void helm");
        expect(pause?.textContent).toContain("Void knight 1/4");
    });

    function createChoice(changes: Partial<ChoiceView> = {}): ChoiceView {
        return {
            title: "Rune scimitar",
            text: "Fast slashing weapon",
            iconObjId: 1333,
            isNew: false,
            isEvolution: false,
            isHilt: false,
            isSpell: false,
            banishable: false,
            banished: false,
            lockable: false,
            locked: false,
            carried: false,
            ...changes,
        };
    }

    function createMockClient(
        store: GameStore,
        overrides: Record<string, unknown> = {},
    ): GameClient {
        const noop = () => {};
        const base = { store, input: { stick: {} }, ...overrides };
        return new Proxy(base, {
            get: (target, key) => (key in target ? target[key as keyof typeof target] : noop),
        }) as unknown as GameClient;
    }

    describe("level up locks", () => {
        test("lock button shows only for lockable cards, and clicking it calls client.lock", () => {
            const store = new GameStore(createSave());
            const lockMock = vi.fn();
            const client = createMockClient(store, { lock: lockMock });
            const hudView: HudView = {
                ...createRunHud(),
                locks: 1,
            };
            store.set({
                screen: "run",
                overlay: "levelUp",
                hud: hudView,
                choices: [
                    createChoice({ title: "Choice 1", lockable: true }),
                    createChoice({ title: "Choice 2", lockable: false }),
                ],
            });
            store.setNumbers(createNumbers());
            const view = render(<GameUi store={store} client={client} />);

            const lockButtons = view.container.querySelectorAll(".ui-lock");
            expect(lockButtons.length).toBe(1);
            expect(lockButtons[0].getAttribute("title")).toBe(
                "Lock Choice 1: it can't be picked now, and comes first at your next level up",
            );

            fireEvent.click(lockButtons[0]);
            expect(lockMock).toHaveBeenCalledWith(0);
        });

        test("locked card is greyed out, not selectable, and shows padlock with note", () => {
            const store = new GameStore(createSave());
            const chooseMock = vi.fn();
            const client = createMockClient(store, { choose: chooseMock });
            const hudView: HudView = {
                ...createRunHud(),
                locks: 1,
            };
            store.set({
                screen: "run",
                overlay: "levelUp",
                hud: hudView,
                choices: [
                    createChoice({ title: "Locked Weapon", locked: true }),
                    createChoice({ title: "Open Weapon" }),
                ],
            });
            store.setNumbers(createNumbers());
            const view = render(<GameUi store={store} client={client} />);

            const cardButtons = view.container.querySelectorAll<HTMLButtonElement>(".ui-choice");
            expect(cardButtons[0]).toBeDisabled();
            expect(cardButtons[0]).toHaveClass("ui-choice-locked");
            expect(cardButtons[0].querySelector(".ui-tag-locked")?.textContent).toContain("Locked");
            expect(cardButtons[0].textContent).toContain(
                "is locked and will show up next level up",
            );

            fireEvent.click(cardButtons[0]);
            expect(chooseMock).not.toHaveBeenCalled();

            expect(cardButtons[1]).not.toBeDisabled();
            fireEvent.click(cardButtons[1]);
            expect(chooseMock).toHaveBeenCalledWith(1);
        });

        test("shows 'N locks left' when hud.locks > 0", () => {
            const store = new GameStore(createSave());
            const client = createMockClient(store);
            store.set({
                screen: "run",
                overlay: "levelUp",
                hud: { ...createRunHud(), locks: 2 },
                choices: [createChoice()],
            });
            store.setNumbers(createNumbers());
            const view = render(<GameUi store={store} client={client} />);

            expect(view.container.querySelector(".ui-locks")?.textContent).toBe("2 locks left");
        });
    });

    describe("stat icons in menus", () => {
        test("a shop card shows its stat's icon even when the wording has none", () => {
            renderShop({}, 100000);
            const defence = screen.getByRole("button", { name: /^Defence\b/ });
            expect(defence.textContent).toContain("Take 1 less damage");
            const line = defence.querySelector(".ui-card-text .ui-stat-line");
            expect(line?.querySelector(".ui-icon")).not.toBeNull();
            expect(line?.querySelector(".ui-stat-spacer")).toBeNull();
        });
    });

    describe("Sailing in the shop", () => {
        test("Set sail is buyable from the start, with no gate", () => {
            const actions = renderShop({}, 100000);
            const sailing = screen.getByRole("button", { name: /^Sailing\b/ });
            expect(sailing).not.toBeDisabled();
            expect(sailing).not.toHaveClass("ui-card-locked");
            expect(sailing.textContent).toContain("Set sail");
            expect(sailing.textContent).not.toContain("Max out");
            expect(screen.queryByRole("button", { name: /^Hunter lock\b/ })).toBeNull();
            expect(screen.queryByRole("button", { name: /^Firemaking lock\b/ })).toBeNull();

            fireEvent.click(sailing);
            expect(actions.buyUpgrade).toHaveBeenCalledWith("sailing", "melee");
        });
    });

    describe("a reward held over by Set sail", () => {
        test("the carried card says why it's on offer", () => {
            const store = new GameStore(createSave());
            const client = createMockClient(store);
            store.set({
                screen: "run",
                overlay: "levelUp",
                hud: createRunHud(),
                choices: [
                    createChoice({ title: "Rune scimitar", carried: true }),
                    createChoice({ title: "Fire rune" }),
                ],
            });
            store.setNumbers(createNumbers());
            const view = render(<GameUi store={store} client={client} />);

            const notes = view.container.querySelectorAll(".ui-card-locked-note");
            expect(notes).toHaveLength(1);
            expect(notes[0].textContent).toContain("locked it last level up");
            expect(view.container.textContent).toContain("Set sail");
            // It can be picked: it's there to be taken
            const cards = view.container.querySelectorAll("button.ui-choice");
            expect((cards[0] as HTMLButtonElement).disabled).toBe(false);
        });
    });

    describe("consistent stat icons (T7)", () => {
        test("level-up choice stats render StatLine icons, value diffs and spacers", () => {
            const store = new GameStore(createSave());
            const client = createMockClient(store);
            store.set({
                screen: "run",
                overlay: "levelUp",
                hud: createRunHud(),
                choices: [
                    createChoice({
                        title: "Dragon scimitar",
                        stats: [
                            { label: "Damage", from: "10", value: "13", better: true },
                            { label: "Attacks", from: "2.00/s", value: "1.67/s", better: false },
                        ],
                    }),
                    createChoice({
                        title: "Strength passive",
                        stats: [{ label: "Damage", from: "+25%", value: "+30%", better: true }],
                    }),
                    createChoice({
                        title: "Mystery upgrade",
                        stats: [{ label: "Unknown bonus", value: "+10" }],
                    }),
                ],
            });
            store.setNumbers(createNumbers());
            const view = render(<GameUi store={store} client={client} />);

            const choiceStats = view.container.querySelectorAll(".ui-choice-stat");
            expect(choiceStats.length).toBe(4);

            // Weapon level up: Damage 10 -> 13
            expect(choiceStats[0]).toHaveClass("ui-stat-line");
            expect(choiceStats[0].querySelector(".ui-icon")).not.toBeNull();
            expect(choiceStats[0].textContent).toContain("Damage 10 → 13");
            expect(choiceStats[0].querySelector(".ui-choice-stat-up")?.textContent).toBe("13");

            // Weapon level up: Attacks 2.00/s -> 1.67/s
            expect(choiceStats[1]).toHaveClass("ui-stat-line");
            expect(choiceStats[1].querySelector(".ui-icon")).not.toBeNull();
            expect(choiceStats[1].textContent).toContain("Attacks 2.00/s → 1.67/s");
            expect(choiceStats[1].querySelector(".ui-choice-stat-down")?.textContent).toBe(
                "1.67/s",
            );

            // Passive level up: Damage +25% -> +30%
            expect(choiceStats[2]).toHaveClass("ui-stat-line");
            expect(choiceStats[2].querySelector(".ui-icon")).not.toBeNull();
            expect(choiceStats[2].textContent).toContain("Damage +25% → +30%");
            expect(choiceStats[2].querySelector(".ui-choice-stat-up")?.textContent).toBe("+30%");

            // Unknown stat: renders spacer
            expect(choiceStats[3]).toHaveClass("ui-stat-line");
            expect(choiceStats[3].querySelector(".ui-stat-spacer")).not.toBeNull();
            expect(choiceStats[3].textContent).toContain("Unknown bonus +10");
        });

        test("ChestModal renders item lines, set progress and replacement diffs with StatLine", () => {
            vi.useFakeTimers();
            try {
                const store = new GameStore(createSave());
                const client = createMockClient(store, { playChestSound: vi.fn() });
                const chest: ChestView = {
                    uid: 1,
                    tierColor: "#ffd700",
                    rarity: "rare",
                    casketObjId: 2724,
                    casketName: "Hard casket",
                    coins: 100,
                    alchCoins: 50,
                    isGear: true,
                    item: {
                        id: "void_top",
                        name: "Void knight top",
                        objId: 8839,
                        rarity: { name: "Rare", color: "#3fe03f" },
                        kindLabel: "Body slot",
                        lines: ["+10% damage", "+2 armour"],
                        set: { text: "Void knight 2/4: 3 worn give +10% damage", active: false },
                    },
                    replaces: {
                        item: {
                            id: "leather_body",
                            name: "Leather body",
                            objId: 1129,
                            rarity: { name: "Common", color: "#ffffff" },
                            kindLabel: "Body slot",
                            lines: ["+1 armour"],
                        },
                        alchCoins: 10,
                    },
                    changes: [
                        { text: "+10% damage", good: true },
                        { text: "-1 armour", good: false },
                    ],
                    carried: 0,
                    canStash: true,
                    instant: false,
                    recommended: "take",
                    queued: 0,
                };

                const view = render(
                    <ChestModal chest={chest} rerolls={0} banishes={0} client={client} />,
                );

                // Advance timers to reveal phase
                act(() => {
                    vi.advanceTimersByTime(2500);
                });

                // Item lines use StatLine
                const lines = view.container.querySelectorAll(".ui-chest-lines .ui-stat-line");
                expect(lines.length).toBe(2);
                expect(lines[0].textContent).toBe("+10% damage");
                expect(lines[0].querySelector(".ui-icon")).not.toBeNull();
                expect(lines[1].textContent).toBe("+2 armour");
                expect(lines[1].querySelector(".ui-icon")).not.toBeNull();

                // Set line uses StatLine
                const setLine = view.container.querySelector(".ui-chest-set .ui-stat-line");
                expect(setLine).not.toBeNull();
                expect(setLine?.textContent).toContain("Void knight 2/4");
                // Set line has spacer since "Void knight..." doesn't match an icon
                expect(setLine?.querySelector(".ui-stat-spacer")).not.toBeNull();

                // Gear changes use StatLine with good/bad coloring
                const changes = view.container.querySelectorAll(".ui-chest-changes .ui-stat-line");
                expect(changes.length).toBe(2);
                expect(changes[0].textContent).toBe("+10% damage");
                expect(changes[0].closest(".ui-good")).not.toBeNull();
                expect(changes[0].querySelector(".ui-icon")).not.toBeNull();
                expect(changes[1].textContent).toBe("-1 armour");
                expect(changes[1].closest(".ui-bad")).not.toBeNull();
                expect(changes[1].querySelector(".ui-icon")).not.toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        test("EventModal renders reward and effect lines with StatLine", () => {
            const store = new GameStore(createSave());
            const client = createMockClient(store);
            const event: EventView = {
                uid: 10,
                name: "Supply chest",
                speech: "Spend your raid points on supplies.",
                leaveLabel: "Leave",
                options: [
                    {
                        title: "Divine magic potion",
                        text: "+25% magic damage for 3 minutes.",
                        iconObjId: 23745,
                        price: 80,
                        sold: false,
                        enabled: true,
                    },
                    {
                        title: "Dwarf multicannon",
                        text: "Sets up a cannon that shoots everything nearby for 20 seconds.",
                        iconObjId: 6,
                        price: 60,
                        sold: false,
                        enabled: true,
                    },
                ],
            };

            const view = render(<EventModal event={event} coins={200} client={client} />);

            const statLines = view.container.querySelectorAll(".ui-card-text .ui-stat-line");
            expect(statLines.length).toBe(2);

            // First option (+25% magic damage) resolves to magic icon
            expect(statLines[0].textContent).toBe("+25% magic damage for 3 minutes.");
            expect(statLines[0].querySelector(".ui-icon")).not.toBeNull();

            // Second option has spacer
            expect(statLines[1].textContent).toContain("Sets up a cannon");
            expect(statLines[1].querySelector(".ui-stat-spacer")).not.toBeNull();
        });
    });
});
