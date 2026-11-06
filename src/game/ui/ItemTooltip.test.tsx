// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ItemView } from "../client/GameStore";
import { ItemTooltip } from "./ItemTooltip";

afterEach(cleanup);

const item: ItemView = {
    id: "helm",
    name: "Void helm",
    objId: 1,
    rarity: { name: "Rare", color: "rgb(1, 2, 3)" },
    kindLabel: "Head slot",
    lines: ["+5% damage", "+1 armour"],
    set: { text: "Void knight 1/4", active: false },
};

describe("ItemTooltip", () => {
    it("shows name, kind, lines and set", () => {
        render(<ItemTooltip item={item} />);
        expect(screen.getByText("Void helm").style.color).toBe("rgb(1, 2, 3)");
        expect(screen.getByText("Head slot")).toBeTruthy();
        expect(screen.getByText("+5% damage")).toBeTruthy();
        expect(screen.getByText("+1 armour")).toBeTruthy();
        expect(screen.getByText("Void knight 1/4").className).not.toContain("item-tip-set-on");
    });

    it("marks an active set", () => {
        render(<ItemTooltip item={{ ...item, set: { text: "Void knight 4/4", active: true } }} />);
        expect(screen.getByText("Void knight 4/4").className).toContain("item-tip-set-on");
    });

    it("omits the set when there is none", () => {
        const { container } = render(<ItemTooltip item={{ ...item, set: undefined }} />);
        expect(container.querySelector(".item-tip-set")).toBeNull();
    });

    it("renders lines through renderLine", () => {
        render(<ItemTooltip item={item} renderLine={(t) => <b data-testid="l">{t}</b>} />);
        expect(screen.getAllByTestId("l").length).toBe(2);
    });
});
