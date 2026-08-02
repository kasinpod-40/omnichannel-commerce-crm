/* ครอบเฉพาะ POST Order เพื่อแสดงสถานะกำลังดำเนินการ โดยไม่เปลี่ยน API contract */
export const DEMO_SHOP_ENHANCEMENT_SCRIPT = `    (() => {
      const overlay = document.getElementById("processing-overlay");
      const message = document.getElementById("processing-message");

      if (!overlay || !message || window.__demoShopFetchWrapped) return;
      window.__demoShopFetchWrapped = true;

      const originalFetch = window.fetch.bind(window);
      const steps = [
        "กำลังสร้างคำสั่งซื้อจำลองจากช่องทาง Shopee",
        "กำลังส่ง Order เข้า Activity และ Notification Flow เดิม",
        "กำลังตัดสต็อกตาม SKU และตรวจสอบแผนผลิต",
      ];
      let stepTimer = 0;

      function requestUrl(input) {
        if (typeof input === "string") return input;
        if (input instanceof URL) return input.toString();
        if (input instanceof Request) return input.url;
        return String(input || "");
      }

      function requestMethod(input, init) {
        if (init && init.method) return String(init.method).toUpperCase();
        if (input instanceof Request) return input.method.toUpperCase();
        return "GET";
      }

      function isDemoOrderRequest(input, init) {
        const method = requestMethod(input, init);
        const url = new URL(requestUrl(input), window.location.origin);
        return method === "POST" && url.pathname === "/demo-shop/api/orders";
      }

      function openProcessing() {
        let stepIndex = 0;
        message.textContent = steps[stepIndex];
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("processing-lock");
        window.clearInterval(stepTimer);
        stepTimer = window.setInterval(() => {
          stepIndex = Math.min(stepIndex + 1, steps.length - 1);
          message.textContent = steps[stepIndex];
        }, 1150);
      }

      function closeProcessing() {
        window.clearInterval(stepTimer);
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("processing-lock");
      }

      window.fetch = async function demoShopFetch(input, init) {
        if (!isDemoOrderRequest(input, init)) {
          return await originalFetch(input, init);
        }

        const startedAt = Date.now();
        openProcessing();

        try {
          return await originalFetch(input, init);
        } finally {
          const minimumVisibleMs = 650;
          const remaining = minimumVisibleMs - (Date.now() - startedAt);
          if (remaining > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, remaining));
          }
          closeProcessing();
        }
      };
    })();`;
