import { Fragment, useState } from "react";

import { GameClient } from "../client/GameClient";
import { UiSnapshot } from "../client/GameStore";
import { getUpgradeLine, getUpgradedGear } from "../content/armoury";
import { CASKET_GEAR, GEAR_SLOTS, GEAR_SLOT_BY_ID, getGear } from "../content/items";
import { RARITIES } from "../content/rarity";
import { describeSetProgress, getItemSet } from "../content/sets";
import { compareStats, formatStats } from "../content/stats";
import { describeUnlockTask, isAvailable } from "../content/unlocks";
import { SaveData, getArmouryStep } from "../core/save";
import "./ArmouryScreen.css";
import { Coins } from "./Coins";
import { ItemIcon } from "./ItemIcon";
import { StatLine } from "./StatLine";

// The Armoury: every piece of gear caskets give, slot by slot, as the
// upgrades have made it (faded until it's been found). Beside them, the piece
// picked: what it is now, its line of upgrades, and the next one's cost.

type Props = { ui: UiSnapshot; client: GameClient };

export function ArmouryScreen({ ui, client }: Props): JSX.Element {
    const save = ui.save;
    const [selected, setSelected] = useState(
        () => CASKET_GEAR.find((g) => save.foundGear.includes(g.id))?.id ?? CASKET_GEAR[0].id,
    );
    return (
        <div className="ui-fill ui-center">
            <div className="ui-panel rs-border rs-background ui-armoury">
                <h2>Armoury</h2>
                <p className="ui-subtle">
                    Gear found in caskets, upgraded here for good: from then on it comes out of
                    every casket as what it&apos;s become.
                </p>
                <div className="ui-armoury-body">
                    <div className="ui-armoury-slots">
                        {GEAR_SLOTS.map((slot) => (
                            <div key={slot.id} className="ui-armoury-slot">
                                <div className="ui-armoury-slot-name">{slot.name}</div>
                                <div className="ui-armoury-pieces">
                                    {CASKET_GEAR.filter((g) => g.slot === slot.id).map((g) => (
                                        <ArmouryTile
                                            key={g.id}
                                            save={save}
                                            itemId={g.id}
                                            selected={g.id === selected}
                                            onSelect={() => setSelected(g.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <ArmouryDetails save={save} itemId={selected} client={client} />
                </div>
                <div className="ui-row">
                    <button className="ui-button" onClick={() => client.showScreen("title")}>
                        Back
                    </button>
                    <span className="ui-armoury-count">
                        Found {save.foundGear.length} / {CASKET_GEAR.length}
                    </span>
                    <Coins amount={save.coins} />
                </div>
            </div>
        </div>
    );
}

// A piece as it is now, with a pip for each upgrade along its line
function ArmouryTile({
    save,
    itemId,
    selected,
    onSelect,
}: {
    save: SaveData;
    itemId: string;
    selected: boolean;
    onSelect: () => void;
}): JSX.Element {
    const found = save.foundGear.includes(itemId);
    const piece = getGear(getUpgradedGear(itemId, save.armoury));
    const steps = getUpgradeLine(itemId).length - 1;
    const upgrades = save.armoury[itemId] ?? 0;
    return (
        <button
            className={
                "ui-card ui-armoury-tile" +
                (selected ? " ui-card-selected" : "") +
                (found ? "" : " ui-card-locked")
            }
            style={found ? { borderColor: RARITIES[piece.rarity].color } : undefined}
            title={found ? piece.name : `${piece.name} (not found yet)`}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <ItemIcon objId={piece.objId} size={30} />
            {found && steps > 0 && (
                <span className="ui-armoury-pips">
                    {Array.from({ length: steps }, (_, i) => (
                        <span
                            key={i}
                            className={i < upgrades ? "ui-armoury-pip ui-pip-on" : "ui-armoury-pip"}
                        />
                    ))}
                </span>
            )}
        </button>
    );
}

function ArmouryDetails({
    save,
    itemId,
    client,
}: {
    save: SaveData;
    itemId: string;
    client: GameClient;
}): JSX.Element {
    const found = save.foundGear.includes(itemId);
    const line = getUpgradeLine(itemId);
    const upgrades = save.armoury[itemId] ?? 0;
    const piece = getGear(getUpgradedGear(itemId, save.armoury));
    const step = getArmouryStep(save, itemId);
    const next = step && getGear(step.into);
    const base = getGear(itemId);
    const set = getItemSet(base);
    // Still locked behind a map task, so caskets don't have it yet
    const lockedBy = isAvailable(base, new Set(save.unlockedItems)) ? undefined : base.unlock;
    let action: JSX.Element;
    if (!found) {
        action = (
            <div className="ui-card-cost">
                {lockedBy
                    ? `${describeUnlockTask(lockedBy)} to find it in caskets.`
                    : "Not found yet: find it in a casket to upgrade it."}
            </div>
        );
    } else if (!step || !next) {
        action = (
            <div className="ui-card-style">
                {line.length > 1 ? "Fully upgraded." : "There's nothing to upgrade it into."}
            </div>
        );
    } else {
        action = (
            <div className="ui-armoury-next">
                <div className="ui-armoury-into">
                    Upgrade into
                    <ItemIcon objId={next.objId} size={22} />
                    <span style={{ color: RARITIES[next.rarity].color }}>{next.name}</span>
                </div>
                {/* Its stats once upgraded, with what they are now */}
                <ul className="ui-armoury-changes">
                    {compareStats(piece.stats, next.stats).map((line) => (
                        <li key={line.key}>
                            <span className="ui-armoury-stat-label">
                                <StatLine text={line.label} statKey={line.key} />
                            </span>
                            <span>
                                {line.from !== undefined && <>{line.from} → </>}
                                <span
                                    className={
                                        line.from === undefined
                                            ? undefined
                                            : line.better
                                              ? "ui-good"
                                              : "ui-bad"
                                    }
                                >
                                    {line.to}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
                {step.locked ? (
                    <div className="ui-card-cost">{describeUnlockTask(step.locked)} to unlock</div>
                ) : (
                    <button
                        className="ui-button ui-button-go ui-armoury-buy"
                        data-silent
                        disabled={save.coins < step.cost}
                        onClick={() => client.upgradeGear(itemId)}
                    >
                        Upgrade <Coins amount={step.cost} />
                    </button>
                )}
            </div>
        );
    }
    return (
        <div className="ui-select-details ui-armoury-details">
            <div className="ui-select-details-head">
                <ItemIcon objId={piece.objId} size={36} />
                <div>
                    <div className="ui-card-title" style={{ color: RARITIES[piece.rarity].color }}>
                        {piece.name}
                    </div>
                    <div className="ui-card-style">
                        {RARITIES[piece.rarity].name} · {GEAR_SLOT_BY_ID.get(piece.slot)!.name} slot
                    </div>
                </div>
            </div>
            <ul className="ui-armoury-stats">
                {formatStats(piece.stats).map((text) => (
                    <li key={text}>
                        <StatLine text={text} />
                    </li>
                ))}
                {set && <li className="ui-armoury-set">{describeSetProgress(set)}</li>}
            </ul>
            {line.length > 1 && (
                <div className="ui-armoury-line">
                    {line.map((id, i) => {
                        const form = getGear(id);
                        return (
                            <Fragment key={id}>
                                {i > 0 && <span className="ui-armoury-arrow">›</span>}
                                <span
                                    className={
                                        "ui-armoury-step" +
                                        (found && i <= upgrades ? " ui-armoury-step-done" : "") +
                                        (found && i === upgrades ? " ui-armoury-step-now" : "")
                                    }
                                    title={form.name}
                                >
                                    <ItemIcon objId={form.objId} size={28} />
                                </span>
                            </Fragment>
                        );
                    })}
                </div>
            )}
            {action}
        </div>
    );
}
