/* ครอบ POST Order เพื่อแสดงสถานะดำเนินการ ผล Notification และเครื่องมือ retry แบบไม่แก้ Stock */
export const DEMO_SHOP_ENHANCEMENT_SCRIPT = `    (() => {
      const overlay = document.getElementById("processing-overlay");
      const message = document.getElementById("processing-message");
      const toast = document.getElementById("toast");

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

      function showOperatorToast(text) {
        if (!toast) return;
        toast.textContent = text;
        toast.classList.add("is-visible");
        window.clearTimeout(showOperatorToast.timer);
        showOperatorToast.timer = window.setTimeout(() => {
          toast.classList.remove("is-visible");
        }, 4200);
      }

      function openProcessing(customSteps = steps) {
        let stepIndex = 0;
        message.textContent = customSteps[stepIndex];
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("processing-lock");
        window.clearInterval(stepTimer);
        stepTimer = window.setInterval(() => {
          stepIndex = Math.min(stepIndex + 1, customSteps.length - 1);
          message.textContent = customSteps[stepIndex];
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
          return "ส่งแจ้งเตือนแล้ว";
        }
        return "ส่งแจ้งเตือนไม่สำเร็จ";
      }

      function appendOutcomeLine(resultBody, labelText, valueText) {
        if (!valueText) return;
        const line = document.createElement("div");
        line.className = "result-line";
        line.dataset.notificationOutcome = "true";
        const label = document.createElement("span");
        label.textContent = labelText;
        const value = document.createElement("strong");
        value.textContent = valueText;
        line.append(label, value);
        resultBody.append(line);
      }

      function appendNotificationOutcome(payload) {
        const resultBody = document.getElementById("result-body");
        const notification = payload && payload.notification;
        if (!resultBody || !notification) return;

        resultBody.querySelectorAll("[data-notification-outcome]").forEach((element) => element.remove());
        appendOutcomeLine(resultBody, "แจ้งเตือนสต็อก", notificationLabel(notification));

        if (Array.isArray(notification.evaluation_messages)) {
          appendOutcomeLine(
            resultBody,
            "ผลประเมิน",
            notification.evaluation_messages.filter(Boolean).join("; ")
          );
        }

        if (Array.isArray(notification.error_messages)) {
          appendOutcomeLine(
            resultBody,
            "สาเหตุ",
            notification.error_messages.filter(Boolean).join("; ")
          );
        }
      }

      async function retryLowStockNotification() {
        const orderNumber = window.prompt("กรอกเลขที่ Shopee Demo Order ที่ต้องการส่งแจ้งเตือนซ้ำ");
        if (!orderNumber || !orderNumber.trim()) return;

        openProcessing([
          "กำลังอ่าน Inventory state จาก Order เดิม",
          "กำลังส่งแจ้งเตือนเข้ากลุ่ม Production & Stock",
        ]);

        try {
          const response = await originalFetch("/demo-shop/api/notifications/low-stock/retry", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_number: orderNumber.trim() }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "ส่งแจ้งเตือนซ้ำไม่สำเร็จ");
          }

          appendNotificationOutcome(payload);
          showOperatorToast(
            payload.notification && payload.notification.status === "QUEUED"
              ? "ส่งแจ้งเตือนจาก Order เดิมแล้ว โดยไม่แก้ Stock"
              : notificationLabel(payload.notification)
          );
        } catch (error) {
          showOperatorToast(error instanceof Error ? error.message : "ส่งแจ้งเตือนซ้ำไม่สำเร็จ");
        } finally {
          closeProcessing();
        }
      }

      function installRetryButton() {
        const toolbar = document.querySelector(".toolbar");
        if (!toolbar || document.getElementById("retry-low-stock-button")) return;
        const button = document.createElement("button");
        button.className = "ghost-button";
        button.id = "retry-low-stock-button";
        button.type = "button";
        button.textContent = "ส่งแจ้งเตือนจาก Order เดิม";
        button.addEventListener("click", retryLowStockNotification);
        toolbar.append(button);
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

      installRetryButton();
    })();`;
