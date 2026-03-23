export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: () => [...queryKeys.auth.all, "me"] as const,
    onlineStats: () => [...queryKeys.auth.all, "online-stats"] as const,
    leaderboard: (limit?: number, offset?: number) =>
      [...queryKeys.auth.all, "leaderboard", { limit, offset }] as const,
  },
  config: {
    all: ["config"] as const,
    full: () => [...queryKeys.config.all, "full"] as const,
    gameModes: () => [...queryKeys.config.all, "game-modes"] as const,
    gameMode: (slug: string) =>
      [...queryKeys.config.all, "game-modes", slug] as const,
  },
  geo: {
    all: ["geo"] as const,
    regions: () => [...queryKeys.geo.all, "regions"] as const,
    regionsGraph: (matchId?: string) =>
      [...queryKeys.geo.all, "graph", matchId] as const,
  },
  matches: {
    all: ["matches"] as const,
    my: (limit?: number, offset?: number) =>
      [...queryKeys.matches.all, "my", { limit, offset }] as const,
    player: (userId: string, limit?: number, offset?: number) =>
      [...queryKeys.matches.all, "player", userId, { limit, offset }] as const,
    detail: (matchId: string) =>
      [...queryKeys.matches.all, matchId] as const,
    result: (matchId: string) =>
      [...queryKeys.matches.all, matchId, "result"] as const,
    snapshots: (matchId: string) =>
      [...queryKeys.matches.all, matchId, "snapshots"] as const,
  },
  tutorial: {
    all: ["tutorial"] as const,
  },
  friends: {
    all: ["friends"] as const,
    list: (limit?: number, offset?: number) =>
      [...queryKeys.friends.all, "list", { limit, offset }] as const,
    received: (limit?: number, offset?: number) =>
      [...queryKeys.friends.all, "received", { limit, offset }] as const,
    sent: (limit?: number, offset?: number) =>
      [...queryKeys.friends.all, "sent", { limit, offset }] as const,
  },
  inventory: {
    all: ["inventory"] as const,
    my: (limit?: number, offset?: number) =>
      [...queryKeys.inventory.all, "my", { limit, offset }] as const,
    wallet: () => [...queryKeys.inventory.all, "wallet"] as const,
    drops: (limit?: number, offset?: number) =>
      [...queryKeys.inventory.all, "drops", { limit, offset }] as const,
    categories: () => [...queryKeys.inventory.all, "categories"] as const,
  },
  cosmetics: {
    all: ["cosmetics"] as const,
    equipped: () => [...queryKeys.cosmetics.all, "equipped"] as const,
  },
  marketplace: {
    all: ["marketplace"] as const,
    config: () => [...queryKeys.marketplace.all, "config"] as const,
    listings: (params?: {
      itemSlug?: string;
      listingType?: string;
      limit?: number;
      offset?: number;
    }) => [...queryKeys.marketplace.all, "listings", params] as const,
    myListings: (limit?: number, offset?: number) =>
      [...queryKeys.marketplace.all, "my-listings", { limit, offset }] as const,
    history: (limit?: number, offset?: number) =>
      [...queryKeys.marketplace.all, "history", { limit, offset }] as const,
  },
  decks: {
    all: ["decks"] as const,
    list: (limit?: number, offset?: number) =>
      [...queryKeys.decks.all, "list", { limit, offset }] as const,
    detail: (deckId: string) =>
      [...queryKeys.decks.all, deckId] as const,
  },
  crafting: {
    all: ["crafting"] as const,
    recipes: () => [...queryKeys.crafting.all, "recipes"] as const,
  },
  developers: {
    all: ["developers"] as const,
    apps: (limit?: number, offset?: number) =>
      [...queryKeys.developers.all, "apps", { limit, offset }] as const,
    app: (appId: string) =>
      [...queryKeys.developers.all, "apps", appId] as const,
    keys: (appId: string) =>
      [...queryKeys.developers.all, "apps", appId, "keys"] as const,
    webhooks: (appId: string) =>
      [...queryKeys.developers.all, "apps", appId, "webhooks"] as const,
    deliveries: (appId: string, webhookId: string) =>
      [
        ...queryKeys.developers.all,
        "apps",
        appId,
        "webhooks",
        webhookId,
        "deliveries",
      ] as const,
    usage: (appId: string) =>
      [...queryKeys.developers.all, "apps", appId, "usage"] as const,
    scopes: () => [...queryKeys.developers.all, "scopes"] as const,
    events: () => [...queryKeys.developers.all, "events"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (limit?: number, offset?: number) =>
      [...queryKeys.notifications.all, "list", { limit, offset }] as const,
    unreadCount: () =>
      [...queryKeys.notifications.all, "unread-count"] as const,
  },
  messages: {
    all: ["messages"] as const,
    conversations: () =>
      [...queryKeys.messages.all, "conversations"] as const,
    thread: (userId: string, limit?: number, offset?: number) =>
      [...queryKeys.messages.all, userId, { limit, offset }] as const,
    unreadCount: () =>
      [...queryKeys.messages.all, "unread-count"] as const,
  },
  share: {
    all: ["share"] as const,
    resource: (shareToken: string) =>
      [...queryKeys.share.all, shareToken] as const,
    snapshot: (shareToken: string) =>
      [...queryKeys.share.all, shareToken, "snapshot"] as const,
  },
} as const;
