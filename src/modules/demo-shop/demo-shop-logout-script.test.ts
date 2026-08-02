import { describe, expect, it } from "vitest";
import { DEMO_SHOP_LOGOUT_SCRIPT } from "./demo-shop-logout-script";

describe("Demo Shop logout script", () => {
    it("renders a same-origin POST logout control and returns to Demo Shop", () => {
        expect(() => new Function(DEMO_SHOP_LOGOUT_SCRIPT)).not.toThrow();
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain('button.textContent = "ออกจากระบบ"');
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain('fetch("/auth/logout"');
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain('method: "POST"');
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain('credentials: "include"');
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain('window.location.replace("/demo-shop")');
    });

    it("hides the control while the page is unauthenticated", () => {
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain(
            'const authenticated = Boolean(document.querySelector(".product-card"))'
        );
        expect(DEMO_SHOP_LOGOUT_SCRIPT).toContain(
            "button.hidden = !authenticated"
        );
    });
});
