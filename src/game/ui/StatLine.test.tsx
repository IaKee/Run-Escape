// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatLine } from "./StatLine";

afterEach(cleanup);

describe("StatLine", () => {
    it("renders a stat with its icon and identical text content", () => {
        const { container } = render(<StatLine text="+5% damage" />);
        const line = container.querySelector(".ui-stat-line");
        expect(line).not.toBeNull();
        expect(line?.textContent).toBe("+5% damage");
        expect(screen.getByText("+5% damage")).toBeInTheDocument();
        expect(container.querySelector(".ui-icon")).not.toBeNull();
        expect(container.querySelector(".ui-stat-spacer")).toBeNull();
    });

    it("renders a spacer when there is no icon for the text", () => {
        const { container } = render(<StatLine text="Rune scimitar" />);
        const line = container.querySelector(".ui-stat-line");
        expect(line).not.toBeNull();
        expect(line?.textContent).toBe("Rune scimitar");
        expect(screen.getByText("Rune scimitar")).toBeInTheDocument();
        const spacer = container.querySelector(".ui-stat-spacer") as HTMLElement | null;
        expect(spacer).not.toBeNull();
        expect(spacer?.style.width).toBe("18px");
        expect(spacer?.style.height).toBe("16px");
        expect(container.querySelector(".ui-icon")).toBeNull();
    });

    it("scales the spacer with the given size", () => {
        const { container } = render(<StatLine text="Plain line" size={32} />);
        const spacer = container.querySelector(".ui-stat-spacer") as HTMLElement | null;
        expect(spacer).not.toBeNull();
        expect(spacer?.style.width).toBe("36px");
        expect(spacer?.style.height).toBe("32px");
    });

    it("renders stats with item objIds and interface sprites", () => {
        const coin = render(<StatLine text="+5% coins" />);
        expect(coin.container.querySelector(".ui-icon")).not.toBeNull();
        expect(coin.container.textContent).toBe("+5% coins");

        const ranged = render(<StatLine text="+24% ranged damage" />);
        expect(ranged.container.querySelector(".ui-icon")).not.toBeNull();
        expect(ranged.container.textContent).toBe("+24% ranged damage");
    });
});
