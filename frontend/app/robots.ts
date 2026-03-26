import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://maplord.pl";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/leaderboard", "/login", "/register", "/share/"],
        disallow: [
          "/api/",
          "/game/",
          "/spectate/",
          "/dashboard",
          "/inventory",
          "/marketplace",
          "/crafting",
          "/cosmetics",
          "/decks",
          "/settings",
          "/friends",
          "/messages",
          "/notifications",
          "/developers",
          "/clans",
          "/profile/",
          "/match/",
          "/lobby/",
          "/replay/",
          "/oauth/",
          "/auth/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
