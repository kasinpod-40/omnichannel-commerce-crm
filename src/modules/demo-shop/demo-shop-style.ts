/* สไตล์ทั้งหมดของหน้า Demo Shop แยกไว้เพื่อให้ตรวจและแก้ไขได้ง่าย */
export const DEMO_SHOP_STYLE = `    :root {
      color-scheme: light;
      --ink: #1c1917;
      --muted: #746d66;
      --line: rgba(28, 25, 23, 0.12);
      --paper: #f7f3ed;
      --card: rgba(255, 255, 255, 0.90);
      --gold: #9d794a;
      --success: #315f49;
      --warning: #8b5d27;
      --danger: #8c3f39;
      --radius-lg: 24px;
      --shadow: 0 20px 54px rgba(47, 38, 28, 0.11);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 7%, rgba(157, 121, 74, 0.10), transparent 29%),
        radial-gradient(circle at 89% 23%, rgba(57, 50, 44, 0.07), transparent 27%),
        var(--paper);
      font-family: "Avenir Next", "Noto Sans Thai", Thonburi, "Leelawadee UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 15px;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    button, input { font: inherit; }

    button:focus-visible,
    a:focus-visible {
      outline: 3px solid rgba(157, 121, 74, 0.38);
      outline-offset: 3px;
    }

    /* โครงหลักและแถบด้านบนของหน้า */
    .shell {
      width: min(1240px, calc(100% - 36px));
      margin: 0 auto;
      padding: 24px 0 66px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0 20px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 11px;
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.08em;
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid rgba(28, 25, 23, 0.52);
      border-radius: 50%;
      font-size: 12px;
      font-weight: 700;
    }

    .environment {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.52);
      font-size: 11px;
    }

    .environment-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 0 4px rgba(49, 95, 73, 0.10);
    }

    /* Hero ลดขนาดให้เหมาะกับหน้าสาธิตและไม่แย่งความสนใจจากสินค้า */
    .hero {
      display: grid;
      grid-template-columns: 1.05fr 0.95fr;
      gap: clamp(32px, 6vw, 76px);
      align-items: end;
      padding: clamp(42px, 6vw, 72px) 0 44px;
    }

    .eyebrow {
      margin: 0 0 14px;
      color: var(--gold);
      font-size: 10px;
      font-weight: 750;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(48px, 6.2vw, 78px);
      font-weight: 520;
      line-height: 0.98;
      letter-spacing: -0.045em;
    }

    .hero-copy {
      margin: 0;
      max-width: 620px;
      color: #615b55;
      font-size: clamp(14px, 1.5vw, 17px);
      line-height: 1.75;
    }

    .hero-note {
      display: block;
      margin-top: 14px;
      color: var(--ink);
      font-size: 11px;
      font-weight: 550;
      line-height: 1.65;
    }

    .catalog-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      margin: 10px 0 20px;
    }

    .catalog-title {
      margin: 0;
      font-size: clamp(27px, 3vw, 36px);
      font-weight: 560;
      line-height: 1.2;
      letter-spacing: -0.025em;
    }

    .catalog-meta {
      color: var(--muted);
      font-size: 11px;
      text-align: right;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ghost-button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.68);
      color: var(--ink);
      padding: 9px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: transform .2s ease, border-color .2s ease, background .2s ease;
    }

    .ghost-button:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(28, 25, 23, 0.28);
      background: #fff;
    }

    .ghost-button:disabled { opacity: .55; cursor: wait; }

    /* กริดและการ์ดสินค้า: หนึ่งการ์ดต่อหนึ่งแบบ/สี และเลือกไซซ์ภายในการ์ด */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px;
    }

    .product-card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--card);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset;
      transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease;
    }

    .product-card:hover {
      transform: translateY(-4px);
      border-color: rgba(28, 25, 23, 0.20);
      box-shadow: var(--shadow);
    }

    .product-visual {
      position: relative;
      display: flex;
      align-items: flex-end;
      min-height: 232px;
      padding: 22px;
      overflow: hidden;
      background: linear-gradient(148deg, var(--tone-a), var(--tone-b) 66%, var(--tone-c));
    }

    .product-visual::before,
    .product-visual::after {
      content: "";
      position: absolute;
      border-radius: 999px;
    }

    .product-visual::before {
      width: 200px;
      height: 200px;
      top: -74px;
      right: -60px;
      border: 1px solid rgba(255, 255, 255, 0.30);
      box-shadow: inset 0 0 0 28px rgba(255, 255, 255, 0.035);
    }

    .product-visual::after {
      width: 132px;
      height: 132px;
      left: -42px;
      bottom: -56px;
      background: rgba(255, 255, 255, 0.09);
    }

    .visual-number {
      position: absolute;
      top: 20px;
      left: 22px;
      color: rgba(255, 255, 255, 0.70);
      font-size: 10px;
      letter-spacing: 0.15em;
    }

    .monogram {
      position: relative;
      z-index: 1;
      color: rgba(255, 255, 255, 0.92);
      font-size: clamp(54px, 5vw, 72px);
      font-weight: 500;
      line-height: 0.85;
      letter-spacing: -0.07em;
      text-shadow: 0 9px 30px rgba(0, 0, 0, 0.15);
    }

    .stock-pill {
      position: absolute;
      right: 18px;
      top: 18px;
      z-index: 2;
      padding: 7px 10px;
      border: 1px solid rgba(255, 255, 255, 0.34);
      border-radius: 999px;
      background: rgba(20, 18, 16, 0.22);
      color: #fff;
      backdrop-filter: blur(12px);
      font-size: 10px;
      font-weight: 650;
    }

    .stock-pill[data-status="LOW_STOCK"] { background: rgba(139, 93, 39, 0.72); }
    .stock-pill[data-status="OUT_OF_STOCK"] { background: rgba(92, 43, 40, 0.76); }

    .product-body { padding: 21px; }

    .product-kicker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 9px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .09em;
      text-transform: uppercase;
    }

    .product-name {
      margin: 0 0 8px;
      min-height: 52px;
      font-size: clamp(19px, 2vw, 22px);
      font-weight: 590;
      line-height: 1.28;
      letter-spacing: -0.02em;
    }

    .product-detail {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .variant-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 14px 0 0;
      padding-top: 13px;
      border-top: 1px solid var(--line);
      font-size: 11px;
    }

    .variant-sku {
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .variant-stock {
      flex: 0 0 auto;
      font-weight: 650;
    }

    /* ตัวเลือกไซซ์ควบคุม SKU และจำนวนคงเหลือที่ใช้สั่งซื้อ */
    .size-block { margin-top: 17px; }

    .size-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 9px;
      font-size: 11px;
      font-weight: 650;
    }

    .size-count {
      color: var(--muted);
      font-size: 10px;
      font-weight: 500;
    }

    .size-options {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .size-option {
      appearance: none;
      min-width: 42px;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.78);
      color: var(--ink);
      cursor: pointer;
      font-size: 11px;
      font-weight: 650;
      transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease;
    }

    .size-option:hover { transform: translateY(-1px); border-color: rgba(28, 25, 23, 0.30); }

    .size-option.is-selected {
      border-color: var(--ink);
      background: var(--ink);
      color: #fff;
    }

    .size-option.is-empty:not(.is-selected) {
      color: #9c948c;
      text-decoration: line-through;
      background: rgba(244, 241, 236, 0.75);
    }

    .product-price {
      margin: 19px 0 15px;
      font-size: 22px;
      font-weight: 580;
      letter-spacing: -0.02em;
    }

    .purchase-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
    }

    .quantity-control {
      display: grid;
      grid-template-columns: 36px 32px 36px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      overflow: hidden;
    }

    .quantity-control button {
      appearance: none;
      height: 42px;
      border: 0;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      font-size: 17px;
    }

    .quantity-value {
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }

    .buy-button {
      appearance: none;
      min-height: 44px;
      border: 1px solid var(--ink);
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      cursor: pointer;
      padding: 0 16px;
      font-size: 12px;
      font-weight: 700;
      transition: transform .2s ease, opacity .2s ease, background .2s ease;
    }

    .buy-button:hover:not(:disabled) { transform: translateY(-1px); background: #302c29; }
    .buy-button:disabled { cursor: not-allowed; opacity: .52; }

    .stock-footnote {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.55;
    }

    /* State card สำหรับ Loading, Error และ Login */
    .state-card {
      grid-column: 1 / -1;
      display: grid;
      place-items: center;
      min-height: 280px;
      padding: 42px;
      border: 1px dashed rgba(28, 25, 23, 0.20);
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.52);
      text-align: center;
    }

    .state-card h2 {
      margin: 0 0 10px;
      font-size: 27px;
      font-weight: 580;
    }

    .state-card p {
      max-width: 560px;
      margin: 0 0 20px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }

    .login-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 18px;
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
    }

    /* แผงสรุปผลหลังสั่งซื้อ */
    .result-panel {
      position: fixed;
      inset: auto 20px 20px auto;
      z-index: 30;
      width: min(420px, calc(100vw - 40px));
      max-height: calc(100vh - 40px);
      overflow: auto;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 22px;
      background: rgba(28, 25, 23, 0.97);
      color: #fff;
      box-shadow: 0 28px 82px rgba(0, 0, 0, .30);
      backdrop-filter: blur(18px);
      transform: translateY(22px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .24s ease, transform .24s ease;
    }

    .result-panel.is-open {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    .result-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 22px 22px 17px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.10);
    }

    .result-label {
      margin: 0 0 5px;
      color: rgba(255, 255, 255, 0.54);
      font-size: 9px;
      font-weight: 750;
      letter-spacing: .13em;
      text-transform: uppercase;
    }

    .result-title {
      margin: 0;
      font-size: 24px;
      font-weight: 580;
    }

    .close-button {
      appearance: none;
      width: 32px;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 50%;
      background: transparent;
      color: #fff;
      cursor: pointer;
    }

    .result-body { padding: 20px 22px 23px; }

    .result-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 18px 0;
    }

    .metric {
      padding: 13px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.045);
    }

    .metric span {
      display: block;
      margin-bottom: 5px;
      color: rgba(255, 255, 255, 0.52);
      font-size: 9px;
    }

    .metric strong {
      font-size: 22px;
      font-weight: 550;
    }

    .result-line {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 9px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.70);
      font-size: 12px;
    }

    .result-line strong {
      color: #fff;
      text-align: right;
      font-weight: 650;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 22px;
      z-index: 40;
      max-width: calc(100vw - 32px);
      padding: 12px 17px;
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      box-shadow: 0 15px 42px rgba(0, 0, 0, .22);
      transform: translate(-50%, 16px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .22s ease, transform .22s ease;
      font-size: 12px;
    }

    .toast.is-visible { opacity: 1; transform: translate(-50%, 0); }

    .footer {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.6;
    }

    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; gap: 22px; }
      .hero-copy { max-width: 700px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 680px) {
      .shell { width: min(100% - 20px, 1240px); padding-top: 12px; }
      .topbar { padding-bottom: 15px; }
      .environment { display: none; }
      .hero { padding: 36px 3px 34px; }
      h1 { font-size: clamp(44px, 15vw, 62px); }
      .catalog-head { align-items: flex-start; flex-direction: column; }
      .catalog-meta { text-align: left; }
      .grid { grid-template-columns: 1fr; }
      .product-visual { min-height: 218px; }
      .product-name { min-height: auto; }
      .result-panel { inset: auto 10px 10px 10px; width: auto; }
      .footer { flex-direction: column; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }`;
