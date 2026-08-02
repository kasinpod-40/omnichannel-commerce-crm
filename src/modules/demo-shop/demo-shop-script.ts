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
        groups: [],
        selectedSkuByGroup: new Map(),
        quantities: new Map(),
        pendingGroupKey: null,
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
        ["#4e5d58", "#879892", "#29332f"],
        ["#716057", "#ad9284", "#40342f"],
        ["#424649", "#7d8386", "#25282a"],
        ["#665a52", "#a6968a", "#3b332e"],
        ["#46504f", "#81908d", "#29302f"],
        ["#554d58", "#928496", "#302b33"],
      ];
      const sizeOrder = [
        "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL",
        "FREE", "F", "ONE SIZE", "ONESIZE"
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

      function cleanProductName(product) {
        const raw = String(product.product_name || product.sku || "").trim();
        return raw
          .replace(/\\s*(?:ไซซ์|size)\\s*(?:XXXL|XXL|XL|XS|XXS|S|M|L|FREE|F|ONE\\s*SIZE)\\s*$/i, "")
          .trim() || raw;
      }

      function groupKeyFor(product) {
        const identity = String(product.style_code || "").trim() || cleanProductName(product);
        return [
          identity,
          String(product.color || "").trim(),
          String(product.category || "").trim(),
        ].join("|").toLocaleLowerCase("th");
      }

      function normalizedSize(product) {
        return String(product.size || "ONE SIZE").trim().toUpperCase() || "ONE SIZE";
      }

      function compareVariants(left, right) {
        const leftSize = normalizedSize(left);
        const rightSize = normalizedSize(right);
        const leftRank = sizeOrder.indexOf(leftSize);
        const rightRank = sizeOrder.indexOf(rightSize);
        const safeLeftRank = leftRank === -1 ? 999 : leftRank;
        const safeRightRank = rightRank === -1 ? 999 : rightRank;
        return safeLeftRank - safeRightRank || leftSize.localeCompare(rightSize, "th") || left.sku.localeCompare(right.sku, "en");
      }

      function groupProducts(products) {
        const grouped = new Map();

        products.forEach((product) => {
          const key = groupKeyFor(product);
          let group = grouped.get(key);
          if (!group) {
            group = {
              group_key: key,
              product_name: cleanProductName(product),
              category: product.category || "คอลเลกชัน",
              style_code: product.style_code || "",
              color: product.color || "",
              variants: [],
            };
            grouped.set(key, group);
          }
          group.variants.push(product);
        });

        return Array.from(grouped.values())
          .map((group) => ({
            ...group,
            variants: group.variants.sort(compareVariants),
          }))
          .sort((left, right) =>
            left.product_name.localeCompare(right.product_name, "th") ||
            left.color.localeCompare(right.color, "th") ||
            left.style_code.localeCompare(right.style_code, "en")
          );
      }

      function defaultVariant(group) {
        const preservedSku = state.selectedSkuByGroup.get(group.group_key);
        const preserved = group.variants.find((variant) => variant.sku === preservedSku);
        return preserved || group.variants.find((variant) => Number(variant.stock_on_hand) > 0) || group.variants[0];
      }

      function selectedVariant(group) {
        const selectedSku = state.selectedSkuByGroup.get(group.group_key);
        return group.variants.find((variant) => variant.sku === selectedSku) || defaultVariant(group);
      }

      function statusLabel(product) {
        if (product.stock_status === "OUT_OF_STOCK" || Number(product.stock_on_hand) <= 0) return "สินค้าหมด";
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

      function monogram(group) {
        const words = String(group.product_name || group.style_code || "DS")
          .trim()
          .split(/\\s+/)
          .filter(Boolean);
        const letters = words.slice(0, 2).map((word) => word[0]).join("");
        return (letters || "DS").toUpperCase();
      }

      function quantityFor(groupKey) {
        return state.quantities.get(groupKey) || 1;
      }

      function setQuantity(groupKey, next, valueElement) {
        state.quantities.set(groupKey, Math.max(1, Math.min(20, next)));
        valueElement.textContent = String(quantityFor(groupKey));
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

      function createProductCard(group, index) {
        const card = createElement("article", "product-card");
        const visual = createElement("div", "product-visual");
        const palette = palettes[hash(group.group_key) % palettes.length];
        visual.style.setProperty("--tone-a", palette[0]);
        visual.style.setProperty("--tone-b", palette[1]);
        visual.style.setProperty("--tone-c", palette[2]);

        const stockPill = createElement("span", "stock-pill");
        const visualNumber = createElement("span", "visual-number", String(index + 1).padStart(2, "0"));
        const monogramElement = createElement("span", "monogram", monogram(group));
        visual.append(visualNumber, stockPill, monogramElement);

        const body = createElement("div", "product-body");
        const kicker = createElement("div", "product-kicker");
        kicker.append(
          createElement("span", "", group.category || "คอลเลกชัน"),
          createElement("span", "", group.style_code || "Demo Collection")
        );

        const name = createElement("h3", "product-name", group.product_name);
        const productDetail = createElement("div", "product-detail");
        productDetail.append(createElement("span", "", group.color || "สีมาตรฐาน"));

        const variantMeta = createElement("div", "variant-meta");
        const skuText = createElement("span", "variant-sku");
        const stockText = createElement("strong", "variant-stock");
        variantMeta.append(skuText, stockText);

        const sizeBlock = createElement("div", "size-block");
        const sizeHead = createElement("div", "size-head");
        sizeHead.append(
          createElement("span", "", "เลือกไซซ์"),
          createElement("span", "size-count", group.variants.length + " ตัวเลือก")
        );
        const sizeOptions = createElement("div", "size-options");
        const sizeButtons = new Map();

        group.variants.forEach((variant) => {
          const sizeButton = createElement("button", "size-option", variant.size || "One Size");
          sizeButton.type = "button";
          sizeButton.dataset.sku = variant.sku;
          sizeButton.setAttribute(
            "aria-label",
            "เลือกไซซ์ " + (variant.size || "One Size") + " คงเหลือ " + variant.stock_on_hand + " ชิ้น"
          );
          if (Number(variant.stock_on_hand) <= 0) sizeButton.classList.add("is-empty");
          sizeButtons.set(variant.sku, sizeButton);
          sizeOptions.append(sizeButton);
        });
        sizeBlock.append(sizeHead, sizeOptions);

        const price = createElement("div", "product-price");
        const row = createElement("div", "purchase-row");
        const quantity = createElement("div", "quantity-control");
        const minus = createElement("button", "", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", "ลดจำนวน " + group.product_name);
        const quantityValue = createElement("span", "quantity-value", String(quantityFor(group.group_key)));
        const plus = createElement("button", "", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", "เพิ่มจำนวน " + group.product_name);
        minus.addEventListener("click", () => setQuantity(group.group_key, quantityFor(group.group_key) - 1, quantityValue));
        plus.addEventListener("click", () => setQuantity(group.group_key, quantityFor(group.group_key) + 1, quantityValue));
        quantity.append(minus, quantityValue, plus);

        const buy = createElement("button", "buy-button", "สั่งซื้อสินค้า");
        buy.type = "button";
        buy.dataset.buyGroup = group.group_key;
        row.append(quantity, buy);

        const footnote = createElement(
          "p",
          "stock-footnote",
          "ข้อมูลลูกค้าและการชำระเงินจะถูกสร้างให้อัตโนมัติ เพื่อสาธิต Flow จริง"
        );

        function updateVariant(variant) {
          state.selectedSkuByGroup.set(group.group_key, variant.sku);
          stockPill.textContent = statusLabel(variant);
          stockPill.dataset.status = variant.stock_status || "NORMAL";
          skuText.textContent = variant.sku;
          stockText.textContent = "คงเหลือ " + variant.stock_on_hand + " ชิ้น";
          price.textContent = money(variant.price_thb);
          buy.dataset.buySku = variant.sku;
          buy.setAttribute("aria-label", "สั่งซื้อ " + group.product_name + " ไซซ์ " + (variant.size || "One Size"));

          sizeButtons.forEach((button, sku) => {
            const selected = sku === variant.sku;
            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", selected ? "true" : "false");
          });
        }

        sizeButtons.forEach((button, sku) => {
          button.addEventListener("click", () => {
            const variant = group.variants.find((item) => item.sku === sku);
            if (variant) updateVariant(variant);
          });
        });

        buy.addEventListener("click", () => purchase(group));
        body.append(kicker, name, productDetail, variantMeta, sizeBlock, price, row, footnote);
        card.append(visual, body);

        state.quantities.set(group.group_key, quantityFor(group.group_key));
        const initialVariant = defaultVariant(group);
        state.selectedSkuByGroup.set(group.group_key, initialVariant.sku);
        updateVariant(initialVariant);

        return card;
      }

      function renderProducts() {
        grid.replaceChildren();
        if (!state.groups.length) {
          renderState("ยังไม่มีสินค้า", "กรุณาเพิ่มสินค้าที่ Active ใน PC_Products ก่อนเริ่มสาธิต");
          return;
        }

        state.groups.forEach((group, index) => {
          grid.append(createProductCard(group, index));
        });
      }

      function setPending(groupKey, pending) {
        state.pendingGroupKey = pending ? groupKey : null;
        document.querySelectorAll("[data-buy-group]").forEach((button) => {
          const isCurrent = button.dataset.buyGroup === groupKey;
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
        appendResultLine(summary, "สินค้า", result.product.product_name + " · ไซซ์ " + result.product.size);
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
        appendResultLine(production, "สถานะการตัดสต็อก", inventoryStatusLabel(result.inventory.status));
        resultBody.append(summary, metrics, production);
        resultPanel.classList.add("is-open");
        resultPanel.focus();
      }

      async function purchase(group) {
        if (state.pendingGroupKey) return;
        const variant = selectedVariant(group);
        if (!variant) {
          showToast("ไม่พบไซซ์ที่เลือก");
          return;
        }

        setPending(group.group_key, true);
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
              sku: variant.sku,
              quantity: quantityFor(group.group_key),
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
          setPending(group.group_key, false);
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
          state.groups = groupProducts(state.products);
          renderProducts();
          meta.textContent = state.groups.length + " แบบ · " + state.products.length + " ไซซ์ · อัปเดตล่าสุด " + new Date(payload.updated_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
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
