import type { Metadata } from "next";

import VaultsPageClient from "../vaults-page-client";

export const metadata: Metadata = {
  title: "Discover Vaults | Polymarket Vault",
  description:
    "Compare live vault mandates, current access state, NAV, and tracked capital before opening a vault workspace.",
};

export default function Page() {
  return <VaultsPageClient />;
}
