import { ReactNode } from "react";

import { ItemView } from "../client/GameStore";
import "./ItemTooltip.css";

const plain = (text: string) => text;

// The body of a worn-gear tooltip. Positioning is up to the caller.
export function ItemTooltip({
    item,
    renderLine = plain,
}: {
    item: ItemView;
    renderLine?: (text: string) => ReactNode;
}) {
    return (
        <div className="item-tip rs-border rs-background">
            <div className="item-tip-name" style={{ color: item.rarity.color }}>
                {item.name}
            </div>
            <div className="item-tip-kind">{item.kindLabel}</div>
            {item.lines.map((line, i) => (
                <div key={i} className="item-tip-line">
                    {renderLine(line)}
                </div>
            ))}
            {item.set && (
                <div className={item.set.active ? "item-tip-set item-tip-set-on" : "item-tip-set"}>
                    {item.set.text}
                </div>
            )}
        </div>
    );
}
