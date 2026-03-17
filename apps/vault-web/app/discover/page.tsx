import type { Metadata } from "next";

import VaultsPageClient from "../vaults-page-client";

export const metadata: Metadata = {
  title: "Vault Overview | Polymarket Vault",
  description:
    "Track vault size, share price, and cycle status across the Polymarket vault dashboard.",
};

export default function Page() {
  return <VaultsPageClient />;
}
