/* ครอบเฉพาะ POST Order เพื่อแสดงสถานะกำลังดำเนินการและผล Notification โดยไม่แก้ Flow หลัก */
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

      function notificationLabel(notification) {
        if (!notification || notification.status === "NOT_REQUIRED") {
          return "ไม่เข้าเงื่อนไขแจ้งเตือน";
        }
        if (notification.status === "QUEUED") {
          return "ส่งเข้าคิวแจ้งเตือนแล้ว";
        }
        return "ส่งแจ้งเตือนไม่สำเร็จ";
      }

      function appendNotificationOutcome(payload) {
        const resultBody = document.getElementById("result-body");
        const notification = payload && payload.notification;
        if (!resultBody || !notification) return;

        resultBody.querySelectorAll("[data-notification-outcome]").forEach((element) => element.remove());
        const line = document.createElement("div");
        line.className = "result-line";
        line.dataset.notificationOutcome = "true";
        const label = document.createElement("span");
        label.textContent = "แจ้งเตือนสต็อก";
        const value = document.createElement("strong");
        value.textContent = notificationLabel(notification);
        line.append(label, value);
        resultBody.append(line);

        if (notification.status === "FAILED" && Array.isArray(notification.error_messages)) {
          const detail = notification.error_messages.filter(Boolean).join("; ");
          if (detail) {
            const errorLine = document.createElement("div");
            errorLine.className = "result-line";
            errorLine.dataset.notificationOutcome = "true";
            const errorLabel = document.createElement("span");
            errorLabel.textContent = "สาเหตุ";
            const errorValue = document.createElement("strong");
            errorValue.textContent = detail;
            errorLine.append(errorLabel, errorValue);
            resultBody.append(errorLine);
          }
        }
      }

      window.fetch = async function demoShopFetch(input, init) {
        if (!isDemoOrderRequest(input, init)) {
          return await originalFetch(input, init);
        }

        const startedAt = Date.now();
        openProcessing();

        try {
          const response = await originalFetch(input, init);
          const payload = await response.clone().json().catch(() => null);
          window.setTimeout(() => appendNotificationOutcome(payload), 0);
          return response;
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
