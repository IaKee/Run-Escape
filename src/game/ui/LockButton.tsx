import { LOCK_SPRITE } from "../content/statIcons";
import { ItemIcon } from "./ItemIcon";

// Locks a level up reward for the next level up (Sailing's Set sail):
// it can't be picked now, and comes first at your next level up
export function LockButton({ title, onLock }: { title: string; onLock: () => void }): JSX.Element {
    return (
        <button
            className="ui-button ui-button-small ui-lock"
            data-silent
            title={title}
            aria-label={title}
            onClick={(e) => {
                e.stopPropagation();
                onLock();
                // Give the number keys back
                e.currentTarget.blur();
            }}
        >
            <ItemIcon objId={-1} spriteId={LOCK_SPRITE} size={16} />
        </button>
    );
}
