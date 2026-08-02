/* ปรับฟอนต์ทั้งหน้าและควบคุม Popup ระหว่างประมวลผลคำสั่งซื้อ */
export const DEMO_SHOP_ENHANCEMENT_STYLE = `
    body,
    button,
    input {
      font-family: "Kanit", "Noto Sans Thai", Tahoma, sans-serif;
    }

    h1,
    .catalog-title,
    .product-name,
    .product-price,
    .result-title,
    .metric strong,
    .state-card h2,
    .monogram,
    .brand-mark {
      font-family: "Kanit", "Noto Sans Thai", Tahoma, sans-serif;
    }

    h1 {
      font-weight: 500;
      letter-spacing: -0.035em;
    }

    .catalog-title,
    .product-name,
    .result-title,
    .state-card h2 {
      font-weight: 500;
      letter-spacing: -0.018em;
    }

    .product-price,
    .metric strong {
      font-weight: 500;
    }

    .monogram {
      font-weight: 300;
      letter-spacing: -0.045em;
    }

    body.processing-lock {
      overflow: hidden;
    }

    /* Popup กลางหน้าจอระหว่างส่ง Shopee Order เข้า Business Flow เดิม */
    .processing-overlay {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 22px;
      background: rgba(20, 18, 16, 0.42);
      backdrop-filter: blur(10px);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity .2s ease, visibility .2s ease;
    }

    .processing-overlay.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .processing-card {
      width: min(430px, 100%);
      padding: 34px 32px 30px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 26px;
      background: rgba(24, 22, 20, 0.96);
      color: #fff;
      box-shadow: 0 34px 100px rgba(0,0,0,.34);
      text-align: center;
      transform: translateY(12px) scale(.985);
      transition: transform .22s ease;
    }

    .processing-overlay.is-open .processing-card {
      transform: translateY(0) scale(1);
    }

    .processing-spinner {
      position: relative;
      width: 58px;
      height: 58px;
      margin: 0 auto 24px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 50%;
    }

    .processing-spinner::before {
      content: "";
      position: absolute;
      inset: 6px;
      border: 2px solid transparent;
      border-top-color: #d9ba88;
      border-right-color: rgba(217,186,136,.42);
      border-radius: 50%;
      animation: demo-shop-spin .9s linear infinite;
    }

    .processing-kicker {
      margin: 0 0 9px;
      color: #d9ba88;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .processing-title {
      margin: 0;
      font-size: 25px;
      font-weight: 500;
      line-height: 1.35;
    }

    .processing-message {
      min-height: 48px;
      margin: 13px 0 0;
      color: rgba(255,255,255,.66);
      font-size: 14px;
      font-weight: 300;
      line-height: 1.7;
    }

    .processing-flow {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 22px;
      color: rgba(255,255,255,.48);
      font-size: 11px;
    }

    .processing-flow strong {
      color: rgba(255,255,255,.86);
      font-weight: 400;
    }

    @keyframes demo-shop-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 680px) {
      .processing-card {
        padding: 30px 22px 26px;
        border-radius: 22px;
      }

      .processing-title {
        font-size: 22px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .processing-spinner::before {
        animation-duration: 1.8s;
      }
    }
`;
