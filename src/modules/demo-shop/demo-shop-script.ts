function serializeInlineScriptValue(value: string): string {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** Script ของหน้าใช้ textContent/DOM API เพื่อไม่ฝังข้อมูลสินค้าลง innerHTML */
export function renderDemoShopScript(dashboardUrl: string): string {
    const serializedDashboardUrl = serializeInlineScriptValue(dashboardUrl);

    return `    (() => {
      const state = {
        products: [],
        quantities: new Map(),
        pendingSku: null,
      };

      const dashboardUrl = ${serializedDashboardUrl};
      const grid = document.getElementById("product-grid");
      const meta = document.getElementById("catalog-meta");
      const refreshButton = document.getElementById("refresh-button");
      const resultPanel = document.getElementById("result-panel");
      const resultBody = document.getElementById("result-body");
      const resultTitle = document.getElementById("result-title");
      const toast = document.getElementById("toast");
      const closeResult = document.getElementById("close-result");

      const palettes = [
        ["#5f5347", "#9f866d", "#302a25"],
        ["#343330", "#77736c", "#1c1b19"],
        ["#6f645d", "#b3a398", "#443d39"],
        ["#42514d", "#788d85", "#24302d"],
        ["#69574f", "#aa8d7e", "#3f312d"],
        ["#3f4652", "#7e8794", "#252a32"],
      ];

      function hash(value) {
        let result = 0;
        for (let index = 0; index < value.length; index += 1) {
          result = ((result << 5) - result + value.charCodeAt(index)) | 0;
        }
        return Math.abs(result);
      }

      function money(value) {
        return new Intl.NumberFormat("th-TH", {
          style: "currency",
          currency: "THB",
          maximumFractionDigits: 0,
        }).format(Number(value) || 0);
      }

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => {
          toast.classList.remove("is-visible");
        }, 3200);
      }

      function createElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      }

      function statusLabel(product) {
        if (product.stock_status === "OUT_OF_STOCK") return "สินค้าหมด";
        if (product.stock_status === "LOW_STOCK") return "สินค้าใกล้หมด";
        return "พร้อมจำหน่าย";
      }

      function inventoryStatusLabel(value) {
        const labels = {
          APPLIED: "ตัดสต็อกแล้ว",
          RELEASED: "คืนสต็อกแล้ว",
          PREPARED: "กำลังเตรียมตัดสต็อก",
          BLOCKED: "ต้องตรวจสอบ",
          UNKNOWN: "ยังไม่ทราบสถานะ",
        };
        return labels[value] || String(value || "ยังไม่ทราบสถานะ");
      }

      function monogram(product) {
        const words = String(product.product_name || product.sku)
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const letters = words.slice(0, 2).map((word) => word[0]).join("");
        return (letters || product.sku.slice(0, 2)).toUpperCase();
      }

      function quantityFor(sku) {
        return state.quantities.get(sku) || 1;
      }

      function setQuantity(sku, next) {
        state.quantities.set(sku, Math.max(1, Math.min(20, next)));
        const value = document.querySelector('[data-qty-value="' + CSS.escape(sku) + '"]');
        if (value) value.textContent = String(quantityFor(sku));
      }

      function renderLoginState() {
        grid.replaceChildren();
        const card = createElement("div", "state-card");
        const wrapper = createElement("div");
        wrapper.append(
          createElement("h2", "", "กรุณาลงชื่อเข้าใช้ก่อน"),
          createElement("p", "", "เปิด Dashboard เพื่อลงชื่อเข้าใช้ด้วย Lark แล้วกลับมารีเฟรชหน้า Demo Shop อีกครั้ง")
        );
        const link = createElement("a", "login-link", "เปิด Dashboard");
        link.href = dashboardUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        wrapper.append(link);
        card.append(wrapper);
        grid.append(card);
        meta.textContent = "ยังไม่ได้ลงชื่อเข้าใช้";
      }

      function renderState(title, description) {
        grid.replaceChildren();
        const card = createElement("div", "state-card");
        const wrapper = createElement("div");
        wrapper.append(
          createElement("h2", "", title),
          createElement("p", "", description)
        );
        card.append(wrapper);
        grid.append(card);
      }

      function createProductCard(product, index) {
        const card = createElement("article", "product-card");
        const visual = createElement("div", "product-visual");
        const palette = palettes[hash(product.sku) % palettes.length];
        visual.style.setProperty("--tone-a", palette[0]);
        visual.style.setProperty("--tone-b", palette[1]);
        visual.style.setProperty("--tone-c", palette[2]);
        visual.append(
          createElement("span", "visual-number", String(index + 1).padStart(2, "0")),
          createElement("span", "stock-pill", statusLabel(product)),
          createElement("span", "monogram", monogram(product))
        );

        const body = createElement("div", "product-body");
        const kicker = createElement("div", "product-kicker");
        kicker.append(
          createElement("span", "", product.category || "คอลเลกชัน"),
          createElement("span", "", product.sku)
        );
        const name = createElement("h3", "product-name", product.product_name || product.sku);
        const detail = createElement("div", "product-detail");
        detail.append(
          createElement("span", "", product.color || "—"),
          createElement("span", "", product.size ? "ไซซ์ " + product.size : "ไซซ์เดียว"),
          createElement("span", "", "สต็อก " + product.stock_on_hand)
        );
        const price = createElement("div", "product-price", money(product.price_thb));

        const row = createElement("div", "purchase-row");
        const quantity = createElement("div", "quantity-control");
        const minus = createElement("button", "", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", "ลดจำนวน " + product.product_name);
        minus.addEventListener("click", () => setQuantity(product.sku, quantityFor(product.sku) - 1));
        const value = createElement("span", "quantity-value", "1");
        value.dataset.qtyValue = product.sku;
        const plus = createElement("button", "", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", "เพิ่มจำนวน " + product.product_name);
        plus.addEventListener("click", () => setQuantity(product.sku, quantityFor(product.sku) + 1));
        quantity.append(minus, value, plus);

        const buy = createElement("button", "buy-button", "สั่งซื้อสินค้า");
        buy.type = "button";
        buy.dataset.buySku = product.sku;
        buy.addEventListener("click", () => purchase(product));
        row.append(quantity, buy);

        const footnote = createElement(
          "p",
          "stock-footnote",
          "ระบบจะสร้างข้อมูลลูกค้าและยืนยันการชำระเงินให้อัตโนมัติ เพื่อสาธิตกระบวนการจริง"
        );
        body.append(kicker, name, detail, price, row, footnote);
        card.append(visual, body);
        return card;
      }

      function renderProducts() {
        grid.replaceChildren();
        if (!state.products.length) {
          renderState("ยังไม่มีสินค้า", "กรุณาเพิ่มสินค้าที่ Active ใน PC_Products ก่อนเริ่มสาธิต");
          return;
        }
        state.products.forEach((product, index) => {
          state.quantities.set(product.sku, quantityFor(product.sku));
          grid.append(createProductCard(product, index));
        });
      }

      function setPending(sku, pending) {
        state.pendingSku = pending ? sku : null;
        document.querySelectorAll("[data-buy-sku]").forEach((button) => {
          const isCurrent = button.dataset.buySku === sku;
          button.disabled = pending;
          if (isCurrent) button.textContent = pending ? "กำลังประมวลผล…" : "สั่งซื้อสินค้า";
        });
      }

      function appendResultLine(container, label, value) {
        const line = createElement("div", "result-line");
        line.append(createElement("span", "", label), createElement("strong", "", value));
        container.append(line);
      }

      function showResult(result) {
        resultTitle.textContent = result.duplicate ? "คำสั่งซื้อนี้ถูกประมวลผลแล้ว" : "สั่งซื้อสำเร็จ";
        resultBody.replaceChildren();
        const summary = createElement("div");
        appendResultLine(summary, "Order", result.order_number);
        appendResultLine(summary, "สินค้า", result.product.product_name + " · " + result.product.size);
        appendResultLine(summary, "จำนวน", String(result.product.quantity) + " ชิ้น");
        appendResultLine(summary, "ยอดรวม", money(result.product.total_amount_thb));

        const metrics = createElement("div", "result-grid");
        const before = createElement("div", "metric");
        before.append(
          createElement("span", "", "สต็อกก่อนสั่ง"),
          createElement("strong", "", result.inventory.stock_before === null ? "—" : String(result.inventory.stock_before))
        );
        const after = createElement("div", "metric");
        after.append(
          createElement("span", "", "สต็อกหลังสั่ง"),
          createElement("strong", "", String(result.inventory.stock_after))
        );
        metrics.append(before, after);

        const production = createElement("div");
        appendResultLine(
          production,
          "แผนผลิต",
          result.production.created_or_updated
            ? result.production.production_ids.join(", ") || "สร้าง/อัปเดตแล้ว"
            : "ยังไม่ต้องผลิตเพิ่ม"
        );
        appendResultLine(
          production,
          "สถานะการตัดสต็อก",
          inventoryStatusLabel(result.inventory.status)
        );
        resultBody.append(summary, metrics, production);
        resultPanel.classList.add("is-open");
        resultPanel.focus();
      }

      async function purchase(product) {
        if (state.pendingSku) return;
        setPending(product.sku, true);
        const idempotencyKey = "demo-shop-" + crypto.randomUUID();

        try {
          const response = await fetch("/demo-shop/api/orders", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              sku: product.sku,
              quantity: quantityFor(product.sku),
            }),
          });
          const payload = await response.json().catch(() => ({}));

          if (response.status === 401) {
            renderLoginState();
            throw new Error("กรุณาลงชื่อเข้าใช้ Dashboard ก่อนสั่งซื้อ");
          }
          if (!response.ok) {
            throw new Error(payload.message || "ไม่สามารถสร้างคำสั่งซื้อได้");
          }

          showResult(payload);
          showToast("คำสั่งซื้อและการตัดสต็อกทำงานสำเร็จ");
          await loadProducts(false);
        } catch (error) {
          showToast(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
        } finally {
          setPending(product.sku, false);
        }
      }

      async function loadProducts(showLoading = true) {
        refreshButton.disabled = true;
        if (showLoading) renderState("กำลังเตรียมคอลเลกชัน", "ระบบกำลังอ่านสินค้าจาก PC_Products");

        try {
          const response = await fetch("/demo-shop/api/products", {
            credentials: "include",
            headers: { "Accept": "application/json" },
          });
          const payload = await response.json().catch(() => ({}));

          if (response.status === 401) {
            renderLoginState();
            return;
          }
          if (!response.ok) {
            throw new Error(payload.message || "โหลดสินค้าไม่สำเร็จ");
          }

          state.products = Array.isArray(payload.products) ? payload.products : [];
          renderProducts();
          meta.textContent = state.products.length + " รายการ · อัปเดตล่าสุด " + new Date(payload.updated_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
        } catch (error) {
          renderState("ไม่สามารถโหลดสินค้าได้", error instanceof Error ? error.message : "กรุณาลองใหม่อีกครั้ง");
          meta.textContent = "เชื่อมต่อไม่สำเร็จ";
        } finally {
          refreshButton.disabled = false;
        }
      }

      refreshButton.addEventListener("click", () => loadProducts(true));
      closeResult.addEventListener("click", () => resultPanel.classList.remove("is-open"));
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") resultPanel.classList.remove("is-open");
      });

      loadProducts(true);
    })();`;
}
