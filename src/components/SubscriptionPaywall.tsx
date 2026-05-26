import type { SubscriptionStatus } from "../services/subscription";

type SubscriptionPaywallProps = {
  status: SubscriptionStatus;
  onPurchase: () => void;
  onRestore: () => void;
  onManage: () => void;
};

const SubscriptionPaywall = ({
  status,
  onPurchase,
  onRestore,
  onManage
}: SubscriptionPaywallProps): JSX.Element => (
  <div className="blocking-screen">
    <div className="card blocking-card paywall-card">
      <img className="blocking-logo" src="/logo-192.png" alt="Barefoot Blender logo" />
      <h1>Barefoot Blender Pro</h1>
      <p>
        Unlock the native iOS and Android app for trimix and nitrox gas blending, dive utilities,
        offline app assets, and ongoing platform maintenance.
      </p>
      <div className="subscription-price">$4.99/year</div>
      <p className="table-note">
        Auto-renews yearly through Apple or Google until canceled. Manage cancellation and refunds
        through your store account. Purchase, restore, and periodic subscription verification require
        an internet connection.
      </p>
      {status.error && <div className="warning">{status.error}</div>}
      <div className="blocking-actions">
        <button className="calculate-button" type="button" disabled={status.loading} onClick={onPurchase}>
          {status.loading ? "Checking..." : "Subscribe"}
        </button>
        <button className="settings-close" type="button" disabled={status.loading} onClick={onRestore}>
          Restore Purchases
        </button>
        <button className="link-button" type="button" onClick={onManage}>
          Manage subscription
        </button>
      </div>
    </div>
  </div>
);

export default SubscriptionPaywall;
