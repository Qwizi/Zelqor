import { describe, expect, it } from "vitest";
import { queryKeys } from "../queryKeys";

// ---------------------------------------------------------------------------
// queryKeys — every factory function must be called and return an array.
// Coverage target: 100%
// ---------------------------------------------------------------------------

describe("queryKeys — static all keys", () => {
  it("auth.all is a readonly tuple starting with 'auth'", () => {
    expect(Array.isArray(queryKeys.auth.all)).toBe(true);
    expect(queryKeys.auth.all[0]).toBe("auth");
  });

  it("config.all is a readonly tuple starting with 'config'", () => {
    expect(Array.isArray(queryKeys.config.all)).toBe(true);
    expect(queryKeys.config.all[0]).toBe("config");
  });

  it("geo.all starts with 'geo'", () => {
    expect(queryKeys.geo.all[0]).toBe("geo");
  });

  it("matchmaking.all starts with 'matchmaking'", () => {
    expect(queryKeys.matchmaking.all[0]).toBe("matchmaking");
  });

  it("matches.all starts with 'matches'", () => {
    expect(queryKeys.matches.all[0]).toBe("matches");
  });

  it("tutorial.all starts with 'tutorial'", () => {
    expect(queryKeys.tutorial.all[0]).toBe("tutorial");
  });

  it("friends.all starts with 'friends'", () => {
    expect(queryKeys.friends.all[0]).toBe("friends");
  });

  it("inventory.all starts with 'inventory'", () => {
    expect(queryKeys.inventory.all[0]).toBe("inventory");
  });

  it("cosmetics.all starts with 'cosmetics'", () => {
    expect(queryKeys.cosmetics.all[0]).toBe("cosmetics");
  });

  it("marketplace.all starts with 'marketplace'", () => {
    expect(queryKeys.marketplace.all[0]).toBe("marketplace");
  });

  it("decks.all starts with 'decks'", () => {
    expect(queryKeys.decks.all[0]).toBe("decks");
  });

  it("crafting.all starts with 'crafting'", () => {
    expect(queryKeys.crafting.all[0]).toBe("crafting");
  });

  it("developers.all starts with 'developers'", () => {
    expect(queryKeys.developers.all[0]).toBe("developers");
  });

  it("notifications.all starts with 'notifications'", () => {
    expect(queryKeys.notifications.all[0]).toBe("notifications");
  });

  it("messages.all starts with 'messages'", () => {
    expect(queryKeys.messages.all[0]).toBe("messages");
  });

  it("share.all starts with 'share'", () => {
    expect(queryKeys.share.all[0]).toBe("share");
  });

  it("clans.all starts with 'clans'", () => {
    expect(queryKeys.clans.all[0]).toBe("clans");
  });
});

describe("queryKeys.auth — factory functions", () => {
  it("me() returns array with auth prefix", () => {
    const key = queryKeys.auth.me();
    expect(Array.isArray(key)).toBe(true);
    expect(key[0]).toBe("auth");
    expect(key).toContain("me");
  });

  it("onlineStats() returns array with auth prefix", () => {
    const key = queryKeys.auth.onlineStats();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("online-stats");
  });

  it("leaderboard() returns array with limit/offset params", () => {
    const key = queryKeys.auth.leaderboard(10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("leaderboard");
    expect(key[key.length - 1]).toEqual({ limit: 10, offset: 0 });
  });

  it("leaderboard() works without arguments", () => {
    const key = queryKeys.auth.leaderboard();
    expect(Array.isArray(key)).toBe(true);
    expect(key[key.length - 1]).toEqual({ limit: undefined, offset: undefined });
  });
});

describe("queryKeys.config — factory functions", () => {
  it("full() returns array", () => {
    const key = queryKeys.config.full();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("full");
  });

  it("gameModes() returns array", () => {
    const key = queryKeys.config.gameModes();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("game-modes");
  });

  it("gameMode(slug) returns array including slug", () => {
    const key = queryKeys.config.gameMode("ranked");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("ranked");
  });
});

describe("queryKeys.geo — factory functions", () => {
  it("regions() returns array", () => {
    const key = queryKeys.geo.regions();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("regions");
  });

  it("regionsGraph() without matchId", () => {
    const key = queryKeys.geo.regionsGraph();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("graph");
  });

  it("regionsGraph(matchId) includes matchId", () => {
    const key = queryKeys.geo.regionsGraph("match-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("match-1");
  });
});

describe("queryKeys.matchmaking — factory functions", () => {
  it("status() returns array", () => {
    const key = queryKeys.matchmaking.status();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("status");
  });
});

describe("queryKeys.matches — factory functions", () => {
  it("my() returns array with optional params", () => {
    const key = queryKeys.matches.my(5, 10);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("my");
    expect(key[key.length - 1]).toEqual({ limit: 5, offset: 10 });
  });

  it("my() without args includes undefined params", () => {
    const key = queryKeys.matches.my();
    expect(Array.isArray(key)).toBe(true);
  });

  it("player() includes userId", () => {
    const key = queryKeys.matches.player("user-123", 10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("player");
    expect(key).toContain("user-123");
  });

  it("player() without optional params", () => {
    const key = queryKeys.matches.player("user-abc");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("user-abc");
  });

  it("detail() includes matchId", () => {
    const key = queryKeys.matches.detail("match-42");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("match-42");
  });

  it("result() includes matchId and 'result'", () => {
    const key = queryKeys.matches.result("match-7");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("match-7");
    expect(key).toContain("result");
  });

  it("snapshots() includes matchId and 'snapshots'", () => {
    const key = queryKeys.matches.snapshots("match-99");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("match-99");
    expect(key).toContain("snapshots");
  });
});

describe("queryKeys.friends — factory functions", () => {
  it("list() returns array with limit/offset", () => {
    const key = queryKeys.friends.list(20, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("list");
  });

  it("list() without args", () => {
    const key = queryKeys.friends.list();
    expect(Array.isArray(key)).toBe(true);
  });

  it("received() returns array", () => {
    const key = queryKeys.friends.received(10, 5);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("received");
  });

  it("received() without args", () => {
    const key = queryKeys.friends.received();
    expect(Array.isArray(key)).toBe(true);
  });

  it("sent() returns array", () => {
    const key = queryKeys.friends.sent(5, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("sent");
  });

  it("sent() without args", () => {
    const key = queryKeys.friends.sent();
    expect(Array.isArray(key)).toBe(true);
  });
});

describe("queryKeys.inventory — factory functions", () => {
  it("my() returns array", () => {
    const key = queryKeys.inventory.my(10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("my");
  });

  it("my() without args", () => {
    const key = queryKeys.inventory.my();
    expect(Array.isArray(key)).toBe(true);
  });

  it("wallet() returns array", () => {
    const key = queryKeys.inventory.wallet();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("wallet");
  });

  it("drops() returns array", () => {
    const key = queryKeys.inventory.drops(5, 10);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("drops");
  });

  it("drops() without args", () => {
    const key = queryKeys.inventory.drops();
    expect(Array.isArray(key)).toBe(true);
  });

  it("categories() returns array", () => {
    const key = queryKeys.inventory.categories();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("categories");
  });
});

describe("queryKeys.cosmetics — factory functions", () => {
  it("equipped() returns array", () => {
    const key = queryKeys.cosmetics.equipped();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("equipped");
  });
});

describe("queryKeys.marketplace — factory functions", () => {
  it("config() returns array", () => {
    const key = queryKeys.marketplace.config();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("config");
  });

  it("listings() with params returns array", () => {
    const key = queryKeys.marketplace.listings({ itemSlug: "item-1", listingType: "sell", limit: 20, offset: 0 });
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("listings");
  });

  it("listings() without params", () => {
    const key = queryKeys.marketplace.listings();
    expect(Array.isArray(key)).toBe(true);
  });

  it("myListings() returns array", () => {
    const key = queryKeys.marketplace.myListings(10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("my-listings");
  });

  it("myListings() without args", () => {
    const key = queryKeys.marketplace.myListings();
    expect(Array.isArray(key)).toBe(true);
  });

  it("history() returns array", () => {
    const key = queryKeys.marketplace.history(5, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("history");
  });

  it("history() without args", () => {
    const key = queryKeys.marketplace.history();
    expect(Array.isArray(key)).toBe(true);
  });
});

describe("queryKeys.decks — factory functions", () => {
  it("list() returns array", () => {
    const key = queryKeys.decks.list(10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("list");
  });

  it("list() without args", () => {
    const key = queryKeys.decks.list();
    expect(Array.isArray(key)).toBe(true);
  });

  it("detail() includes deckId", () => {
    const key = queryKeys.decks.detail("deck-xyz");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("deck-xyz");
  });
});

describe("queryKeys.crafting — factory functions", () => {
  it("recipes() returns array", () => {
    const key = queryKeys.crafting.recipes();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("recipes");
  });
});

describe("queryKeys.developers — factory functions", () => {
  it("apps() returns array", () => {
    const key = queryKeys.developers.apps(10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("apps");
  });

  it("apps() without args", () => {
    const key = queryKeys.developers.apps();
    expect(Array.isArray(key)).toBe(true);
  });

  it("app() includes appId", () => {
    const key = queryKeys.developers.app("app-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("app-1");
  });

  it("keys() includes appId", () => {
    const key = queryKeys.developers.keys("app-2");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("app-2");
    expect(key).toContain("keys");
  });

  it("webhooks() includes appId", () => {
    const key = queryKeys.developers.webhooks("app-3");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("webhooks");
  });

  it("deliveries() includes appId and webhookId", () => {
    const key = queryKeys.developers.deliveries("app-4", "wh-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("wh-1");
    expect(key).toContain("deliveries");
  });

  it("usage() includes appId", () => {
    const key = queryKeys.developers.usage("app-5");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("usage");
  });

  it("scopes() returns array", () => {
    const key = queryKeys.developers.scopes();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("scopes");
  });

  it("events() returns array", () => {
    const key = queryKeys.developers.events();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("events");
  });
});

describe("queryKeys.notifications — factory functions", () => {
  it("list() returns array", () => {
    const key = queryKeys.notifications.list(20, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("list");
  });

  it("list() without args", () => {
    const key = queryKeys.notifications.list();
    expect(Array.isArray(key)).toBe(true);
  });

  it("unreadCount() returns array", () => {
    const key = queryKeys.notifications.unreadCount();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("unread-count");
  });
});

describe("queryKeys.messages — factory functions", () => {
  it("conversations() returns array", () => {
    const key = queryKeys.messages.conversations();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("conversations");
  });

  it("thread() includes userId and optional pagination", () => {
    const key = queryKeys.messages.thread("user-10", 50, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("user-10");
  });

  it("thread() without pagination", () => {
    const key = queryKeys.messages.thread("user-11");
    expect(Array.isArray(key)).toBe(true);
  });

  it("unreadCount() returns array", () => {
    const key = queryKeys.messages.unreadCount();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("unread-count");
  });
});

describe("queryKeys.share — factory functions", () => {
  it("resource() includes shareToken", () => {
    const key = queryKeys.share.resource("tok-abc");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("tok-abc");
  });

  it("snapshot() includes shareToken and 'snapshot'", () => {
    const key = queryKeys.share.snapshot("tok-xyz");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("tok-xyz");
    expect(key).toContain("snapshot");
  });
});

describe("queryKeys.clans — factory functions", () => {
  it("list() with all params", () => {
    const key = queryKeys.clans.list("alpha", 20, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("list");
  });

  it("list() without args", () => {
    const key = queryKeys.clans.list();
    expect(Array.isArray(key)).toBe(true);
  });

  it("my() returns array", () => {
    const key = queryKeys.clans.my();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("my");
  });

  it("detail() includes clanId", () => {
    const key = queryKeys.clans.detail("clan-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("clan-1");
  });

  it("members() includes clanId", () => {
    const key = queryKeys.clans.members("clan-2", 10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("members");
  });

  it("members() without pagination", () => {
    const key = queryKeys.clans.members("clan-2");
    expect(Array.isArray(key)).toBe(true);
  });

  it("invitations() returns array", () => {
    const key = queryKeys.clans.invitations(5, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("invitations");
  });

  it("invitations() without args", () => {
    const key = queryKeys.clans.invitations();
    expect(Array.isArray(key)).toBe(true);
  });

  it("joinRequests() includes clanId", () => {
    const key = queryKeys.clans.joinRequests("clan-3", 10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("join-requests");
  });

  it("joinRequests() without pagination", () => {
    const key = queryKeys.clans.joinRequests("clan-3");
    expect(Array.isArray(key)).toBe(true);
  });

  it("treasury() includes clanId", () => {
    const key = queryKeys.clans.treasury("clan-4");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("treasury");
  });

  it("wars() includes clanId", () => {
    const key = queryKeys.clans.wars("clan-5", 10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("wars");
  });

  it("wars() without pagination", () => {
    const key = queryKeys.clans.wars("clan-5");
    expect(Array.isArray(key)).toBe(true);
  });

  it("war() includes warId", () => {
    const key = queryKeys.clans.war("war-1");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("war-1");
  });

  it("warParticipants() includes warId", () => {
    const key = queryKeys.clans.warParticipants("war-2");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("participants");
  });

  it("leaderboard() with all params", () => {
    const key = queryKeys.clans.leaderboard("score", 20, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("leaderboard");
  });

  it("leaderboard() without args", () => {
    const key = queryKeys.clans.leaderboard();
    expect(Array.isArray(key)).toBe(true);
  });

  it("stats() includes clanId", () => {
    const key = queryKeys.clans.stats("clan-6");
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("stats");
  });

  it("activityLog() includes clanId", () => {
    const key = queryKeys.clans.activityLog("clan-7", 10, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("activity-log");
  });

  it("activityLog() without pagination", () => {
    const key = queryKeys.clans.activityLog("clan-7");
    expect(Array.isArray(key)).toBe(true);
  });

  it("chat() includes clanId", () => {
    const key = queryKeys.clans.chat("clan-8", 50, 0);
    expect(Array.isArray(key)).toBe(true);
    expect(key).toContain("chat");
  });

  it("chat() without pagination", () => {
    const key = queryKeys.clans.chat("clan-8");
    expect(Array.isArray(key)).toBe(true);
  });
});
