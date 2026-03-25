import type { Metadata } from "next";

import VaultsPageClient from "../vaults-page-client";

export const metadata: Metadata = {
  title: "Discover Vaults | Polymarket Vault",
  description:
    "Browse and compare available vaults.",
};

export default function Page() {
  return <VaultsPageClient />;
}
