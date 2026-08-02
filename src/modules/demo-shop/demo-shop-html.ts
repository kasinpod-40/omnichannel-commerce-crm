import { renderDemoShopScript } from "./demo-shop-script";
import { DEMO_SHOP_STYLE } from "./demo-shop-style";
import { DEMO_SHOP_ENHANCEMENT_STYLE } from "./demo-shop-enhancement-style";
import { DEMO_SHOP_ENHANCEMENT_SCRIPT } from "./demo-shop-enhancement-script";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function renderDemoShopHtml(input: {
    dashboardUrl: string;
    nonce: string;
}): string {
    const nonce = escapeHtml(input.nonce);
    const script = renderDemoShopScript(input.dashboardUrl);

    return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#171513" />
  <title>Demo Shop</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap" />
  <style nonce="${nonce}">${DEMO_SHOP_STYLE}${DEMO_SHOP_ENHANCEMENT_STYLE}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">DS</span><span>พื้นที่สาธิตส่วนตัว</span></div>
      <div class="environment"><span class="environment-dot"></span><span>ช่องทางจำลอง Shopee · ใช้ Business Flow เดิม</span></div>
    </header>

    <section class="hero" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">ประสบการณ์สั่งซื้อที่ออกแบบอย่างพิถีพิถัน</p>
        <h1 id="page-title">Demo Shop</h1>
      </div>
      <p class="hero-copy">
        เลือกแบบ เลือกไซซ์ และสั่งซื้อ เพื่อสาธิตเส้นทาง Shopee Order → Notification → Stock → แผนผลิต ผ่านกระบวนการจริงของระบบ
        <span class="hero-note">ข้อมูลลูกค้า ร้านค้า การชำระเงิน และสถานะ Marketplace จะถูกสร้างเป็นข้อมูลสาธิตให้อัตโนมัติ</span>
      </p>
    </section>

    <section aria-labelledby="collection-title">
      <div class="catalog-head">
        <div>
          <p class="eyebrow">คอลเลกชันสินค้า</p>
          <h2 class="catalog-title" id="collection-title">สินค้าสำหรับสาธิต</h2>
        </div>
        <div class="toolbar">
          <div class="catalog-meta" id="catalog-meta">กำลังโหลดสินค้า…</div>
          <button class="ghost-button" id="refresh-button" type="button">รีเฟรช</button>
        </div>
      </div>
      <div class="grid" id="product-grid" aria-live="polite"></div>
    </section>

    <footer class="footer">
      <span>Demo Shop · ระบบบริหารการขายหลายช่องทาง</span>
      <span>หน้าสาธิตนี้ไม่ใช่ร้านค้าออนไลน์สำหรับลูกค้าปลายทาง</span>
    </footer>
  </main>

  <aside class="result-panel" id="result-panel" tabindex="-1" aria-live="polite" aria-label="ผลการสั่งซื้อ">
    <div class="result-head">
      <div>
        <p class="result-label">ประมวลผลคำสั่งซื้อแล้ว</p>
        <h2 class="result-title" id="result-title">สั่งซื้อสำเร็จ</h2>
      </div>
      <button class="close-button" id="close-result" type="button" aria-label="ปิดผลลัพธ์">×</button>
    </div>
    <div class="result-body" id="result-body"></div>
  </aside>

  <div class="toast" id="toast" role="status"></div>

  <div class="processing-overlay" id="processing-overlay" aria-hidden="true">
    <section class="processing-card" role="dialog" aria-modal="true" aria-labelledby="processing-title" aria-describedby="processing-message">
      <div class="processing-spinner" aria-hidden="true"></div>
      <p class="processing-kicker">Shopee Order Simulation</p>
      <h2 class="processing-title" id="processing-title">กำลังดำเนินการ</h2>
      <p class="processing-message" id="processing-message">กำลังส่งคำสั่งซื้อเข้าสู่ระบบ</p>
      <div class="processing-flow" aria-hidden="true">
        <strong>Order</strong><span>→</span><strong>Notification</strong><span>→</span><strong>Stock</strong><span>→</span><strong>Production</strong>
      </div>
    </section>
  </div>

  <script nonce="${nonce}">${script}</script>
  <script nonce="${nonce}">${DEMO_SHOP_ENHANCEMENT_SCRIPT}</script>
</body>
</html>`;
}
