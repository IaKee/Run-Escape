import { statIconFor, statKeyIcon } from "../content/statIcons";
import { StatKey } from "../content/types";
import { ItemIcon } from "./ItemIcon";

const ICON_WIDTH = 36;
const ICON_HEIGHT = 32;

// A stat or bonus line with its OSRS icon, or a spacer when it has none so lines line up.
// A menu that knows the stat's key passes it, so wording like "Take 1 less damage" still
// gets its icon.
export function StatLine({
    text,
    size = 16,
    statKey,
}: {
    text: string;
    size?: number;
    statKey?: StatKey;
}): JSX.Element {
    const icon = (statKey && statKeyIcon(statKey)) || statIconFor(text);
    const width = Math.round((size * ICON_WIDTH) / ICON_HEIGHT);
    return (
        <div className="ui-stat-line">
            {icon ? (
                <ItemIcon objId={icon.objId ?? -1} spriteId={icon.spriteId} size={size} />
            ) : (
                <span
                    className="ui-stat-spacer"
                    style={{ width, height: size }}
                    aria-hidden="true"
                />
            )}
            <span>{text}</span>
        </div>
    );
}
