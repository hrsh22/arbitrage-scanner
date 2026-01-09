import { NextRequest, NextResponse } from "next/server";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  tags?: GammaTag[];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slugs = searchParams.get("slugs");

  if (!slugs) {
    return NextResponse.json({ error: "slugs parameter required" }, { status: 400 });
  }

  const slugList = slugs.split(",").filter(Boolean);
  if (slugList.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const results: Record<string, string[]> = {};

  const fetchPromises = slugList.map(async (slug) => {
    try {
      const response = await fetch(`${GAMMA_API_BASE}/events/slug/${slug}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      });

      if (!response.ok) {
        results[slug] = [];
        return;
      }

      const event = (await response.json()) as GammaEvent;
      results[slug] = event.tags?.map((t) => t.label) ?? [];
    } catch {
      results[slug] = [];
    }
  });

  await Promise.all(fetchPromises);

  return NextResponse.json({ events: results });
}
