/* เพิ่มปุ่มออกจากระบบสำหรับ Demo Shop และกลับสู่หน้า Login Lark โดยตรง */
export const DEMO_SHOP_LOGOUT_SCRIPT = `    (() => {
      const toolbar = document.querySelector(".toolbar");
      const grid = document.getElementById("product-grid");
      const toast = document.getElementById("toast");

      if (!toolbar || window.__demoShopLogoutInstalled) return;
      window.__demoShopLogoutInstalled = true;

      const button = document.createElement("button");
      button.className = "ghost-button";
      button.id = "logout-button";
      button.type = "button";
      button.textContent = "ออกจากระบบ";
      button.hidden = true;
      toolbar.append(button);

      function showLogoutToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(showLogoutToast.timer);
        showLogoutToast.timer = window.setTimeout(() => {
          toast.classList.remove("is-visible");
        }, 3600);
      }

      function syncLogoutVisibility() {
        const authenticated = Boolean(document.querySelector(".product-card"));
        button.hidden = !authenticated;
      }

      async function logout() {
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = "กำลังออกจากระบบ…";

        try {
          const response = await fetch("/auth/logout", {
            method: "POST",
            credentials: "include",
            headers: { "Accept": "application/json" },
          });
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(payload.message || "ออกจากระบบไม่สำเร็จ");
          }

          window.location.replace("/demo-shop");
        } catch (error) {
          button.disabled = false;
          button.textContent = "ออกจากระบบ";
          showLogoutToast(
            error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ"
          );
        }
      }

      button.addEventListener("click", logout);

      if (grid) {
        const observer = new MutationObserver(syncLogoutVisibility);
        observer.observe(grid, { childList: true });
      }

      syncLogoutVisibility();
    })();`;
