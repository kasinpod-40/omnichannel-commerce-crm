/* สไตล์ทั้งหมดของหน้า Demo Shop แยกไว้เพื่อให้ตรวจและแก้ไขได้ง่าย */
export const DEMO_SHOP_STYLE = `    :root {
      color-scheme: light;
      --ink: #171513;
      --muted: #746e66;
      --line: rgba(23, 21, 19, 0.12);
      --paper: #f7f4ef;
      --card: rgba(255, 255, 255, 0.88);
      --gold: #a98452;
      --success: #285d45;
      --warning: #8a5d25;
      --danger: #8b3a35;
      --radius-lg: 28px;
      --radius-md: 18px;
      --shadow: 0 22px 70px rgba(47, 38, 28, 0.12);
    }

    * { box-sizing: border-box; }

    html { scroll-behavior: smooth; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 8%, rgba(169, 132, 82, 0.10), transparent 30%),
        radial-gradient(circle at 88% 24%, rgba(45, 39, 34, 0.08), transparent 28%),
        var(--paper);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button, input { font: inherit; }

    button:focus-visible,
    a:focus-visible {
      outline: 3px solid rgba(169, 132, 82, 0.42);
      outline-offset: 3px;
    }

    /* ส่วนหัวหลักของหน้า Demo Shop */
    .shell {
      width: min(1260px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 72px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0 26px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 700;
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(23, 21, 19, 0.58);
      border-radius: 50%;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 14px;
      letter-spacing: 0;
    }

    .environment {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(255,255,255,0.48);
      font-size: 12px;
    }

    .environment-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 0 4px rgba(40, 93, 69, 0.10);
    }

    .hero {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: clamp(28px, 7vw, 92px);
      align-items: end;
      padding: clamp(54px, 8vw, 108px) 0 52px;
    }

    .eyebrow {
      margin: 0 0 20px;
      color: var(--gold);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 760px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(56px, 9vw, 118px);
      font-weight: 400;
      line-height: 0.88;
      letter-spacing: -0.055em;
    }

    .hero-copy {
      margin: 0;
      color: var(--muted);
      font-size: clamp(15px, 2vw, 18px);
      line-height: 1.8;
    }

    .hero-note {
      display: block;
      margin-top: 18px;
      color: var(--ink);
      font-size: 12px;
      line-height: 1.65;
    }

    .catalog-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      margin: 18px 0 22px;
    }

    .catalog-title {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(28px, 4vw, 42px);
      font-weight: 400;
      letter-spacing: -0.025em;
    }

    .catalog-meta {
      color: var(--muted);
      font-size: 12px;
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
      background: rgba(255,255,255,0.62);
      color: var(--ink);
      padding: 10px 15px;
      cursor: pointer;
      transition: transform .2s ease, border-color .2s ease, background .2s ease;
    }

    .ghost-button:hover {
      transform: translateY(-1px);
      border-color: rgba(23, 21, 19, 0.28);
      background: #fff;
    }

    /* กริดการ์ดสินค้าหลัก */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 22px;
    }

    .product-card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--card);
      box-shadow: 0 1px 0 rgba(255,255,255,0.9) inset;
      transition: transform .28s ease, box-shadow .28s ease, border-color .28s ease;
    }

    .product-card:hover {
      transform: translateY(-5px);
      border-color: rgba(23, 21, 19, 0.20);
      box-shadow: var(--shadow);
    }

    .product-visual {
      position: relative;
      display: flex;
      align-items: flex-end;
      min-height: 312px;
      padding: 26px;
      overflow: hidden;
      background:
        linear-gradient(148deg, var(--tone-a), var(--tone-b) 66%, var(--tone-c));
    }

    .product-visual::before,
    .product-visual::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      filter: blur(1px);
    }

    .product-visual::before {
      width: 250px;
      height: 250px;
      top: -88px;
      right: -74px;
      border: 1px solid rgba(255,255,255,0.34);
      box-shadow: inset 0 0 0 34px rgba(255,255,255,0.04);
    }

    .product-visual::after {
      width: 170px;
      height: 170px;
      left: -52px;
      bottom: -68px;
      background: rgba(255,255,255,0.10);
    }

    .visual-number {
      position: absolute;
      top: 24px;
      left: 26px;
      color: rgba(255,255,255,0.72);
      font-size: 11px;
      letter-spacing: 0.18em;
    }

    .monogram {
      position: relative;
      z-index: 1;
      color: rgba(255,255,255,0.92);
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(68px, 8vw, 108px);
      font-weight: 400;
      line-height: 0.78;
      letter-spacing: -0.09em;
      text-shadow: 0 10px 36px rgba(0,0,0,0.16);
    }

    .stock-pill {
      position: absolute;
      right: 20px;
      top: 20px;
      z-index: 2;
      padding: 8px 11px;
      border: 1px solid rgba(255,255,255,0.38);
      border-radius: 999px;
      background: rgba(20,18,16,0.24);
      color: #fff;
      backdrop-filter: blur(12px);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .03em;
    }

    .product-body { padding: 24px; }

    .product-kicker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .product-name {
      margin: 0 0 10px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 27px;
      font-weight: 400;
      line-height: 1.12;
      letter-spacing: -0.02em;
    }

    .product-detail {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      min-height: 22px;
      color: var(--muted);
      font-size: 13px;
    }

    .product-price {
      margin: 22px 0 18px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 25px;
    }

    .purchase-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
    }

    .quantity-control {
      display: grid;
      grid-template-columns: 38px 34px 38px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      overflow: hidden;
    }

    .quantity-control button {
      appearance: none;
      height: 44px;
      border: 0;
      background: transparent;
      cursor: pointer;
      color: var(--ink);
      font-size: 18px;
    }

    .quantity-value {
      text-align: center;
      font-size: 13px;
      font-weight: 700;
    }

    .buy-button {
      appearance: none;
      min-height: 46px;
      border: 1px solid var(--ink);
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      cursor: pointer;
      padding: 0 18px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .02em;
      transition: transform .2s ease, opacity .2s ease, background .2s ease;
    }

    .buy-button:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #2c2925;
    }

    .buy-button:disabled {
      cursor: not-allowed;
      opacity: .52;
    }

    .stock-footnote {
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.55;
    }

    /* State card สำหรับ Loading, Error และ Login */
    .state-card {
      grid-column: 1 / -1;
      display: grid;
      place-items: center;
      min-height: 320px;
      padding: 46px;
      border: 1px dashed rgba(23, 21, 19, 0.20);
      border-radius: var(--radius-lg);
      background: rgba(255,255,255,0.50);
      text-align: center;
    }

    .state-card h2 {
      margin: 0 0 12px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 32px;
      font-weight: 400;
    }

    .state-card p {
      max-width: 560px;
      margin: 0 0 22px;
      color: var(--muted);
      line-height: 1.75;
    }

    .login-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 20px;
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
    }

    /* แผงสรุปผลหลังสั่งซื้อ */
    .result-panel {
      position: fixed;
      inset: auto 20px 20px auto;
      z-index: 30;
      width: min(440px, calc(100vw - 40px));
      max-height: calc(100vh - 40px);
      overflow: auto;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      background: rgba(23, 21, 19, 0.96);
      color: #fff;
      box-shadow: 0 30px 90px rgba(0,0,0,.30);
      backdrop-filter: blur(18px);
      transform: translateY(24px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
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
      padding: 24px 24px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
    }

    .result-label {
      margin: 0 0 5px;
      color: rgba(255,255,255,0.55);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .result-title {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 29px;
      font-weight: 400;
    }

    .close-button {
      appearance: none;
      width: 34px;
      height: 34px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 50%;
      background: transparent;
      color: #fff;
      cursor: pointer;
    }

    .result-body { padding: 22px 24px 26px; }

    .result-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 20px 0;
    }

    .metric {
      padding: 14px;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 14px;
      background: rgba(255,255,255,0.045);
    }

    .metric span {
      display: block;
      margin-bottom: 5px;
      color: rgba(255,255,255,0.52);
      font-size: 10px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .metric strong {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 24px;
      font-weight: 400;
    }

    .result-line {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.72);
      font-size: 13px;
    }

    .result-line strong {
      color: #fff;
      text-align: right;
      font-weight: 600;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 40;
      max-width: calc(100vw - 32px);
      padding: 13px 18px;
      border-radius: 999px;
      background: var(--ink);
      color: #fff;
      box-shadow: 0 16px 46px rgba(0,0,0,.22);
      transform: translate(-50%, 18px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .22s ease, transform .22s ease;
      font-size: 13px;
    }

    .toast.is-visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    .footer {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-top: 54px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.65;
    }

    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; }
      .hero-copy { max-width: 680px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 680px) {
      .shell { width: min(100% - 20px, 1260px); padding-top: 12px; }
      .topbar { padding-bottom: 16px; }
      .environment { display: none; }
      .hero { padding: 44px 4px 38px; }
      h1 { font-size: clamp(56px, 20vw, 86px); }
      .catalog-head { align-items: flex-start; flex-direction: column; }
      .catalog-meta { text-align: left; }
      .grid { grid-template-columns: 1fr; }
      .product-visual { min-height: 286px; }
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
