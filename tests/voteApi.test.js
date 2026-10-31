import { beforeEach, expect, mock, test } from "bun:test";

let response;
const fetch = mock(async () => response);
const statistic = mock(() => {});
mock.module("react-native-url-polyfill/auto", () => ({}));
mock.module("react-native", () => ({ Alert: { alert: mock(() => {}) } }));
mock.module("../api/Authentication", () => ({
  UserAuth: { modhash: "test-session" },
}));
mock.module("../utils/RedditCookies", () => ({
  default: { persistSessionCookies: async () => {} },
}));
mock.module("../api/UserAgent", () => ({ USER_AGENT: "test" }));
mock.module("../utils/safeFetch", () => ({ default: fetch }));
mock.module("../api/Posts", () => ({
  VoteOption: { UpVote: 1, NoVote: 0, DownVote: -1 },
  formatPostData: () => undefined,
  handleGatedSubreddit: () => undefined,
}));
mock.module("../api/Flair", () => ({ formatFlair: () => undefined }));
mock.module("../utils/RedditURL", () => ({ default: class {} }));
mock.module("../utils/Time", () => ({ default: class {} }));
mock.module("../utils/KeyStore", () => ({ default: {} }));
mock.module("../db/functions/Stats", () => ({
  modifyStat: statistic,
  Stat: { POST_UPVOTES: "up", POST_DOWNVOTES: "down" },
}));

const { setVote, vote } = await import("../api/PostDetail");
const { UserAuth } = await import("../api/Authentication");
const { Alert } = await import("react-native");
const item = { name: "t3_example", type: "post", userVote: 1 };
beforeEach(() => {
  UserAuth.modhash = "test-session";
  Alert.alert.mockClear();
  response = {
    ok: true,
    status: 200,
    json: async () => ({ json: { errors: [] } }),
  };
  fetch.mockClear();
  statistic.mockClear();
});

test("absolute votes do not toggle against the current item and count only successful writes", async () => {
  expect(await setVote(item, 1)).toBe(1);
  const body = new URLSearchParams(fetch.mock.calls[0][1].body);
  expect(body.get("id")).toBe("t3_example");
  expect(body.get("dir")).toBe("1");
  expect(body.get("api_type")).toBe("json");
  expect(statistic).toHaveBeenCalledWith("up", 1);
});

test("the existing toggle wrapper still removes a selected vote", async () => {
  expect(await vote(item, 1)).toBe(0);
  expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("dir")).toBe("0");
  expect(statistic).not.toHaveBeenCalled();
});

for (const [name, body] of [
  ["nested Reddit errors", { json: { errors: [["RATELIMIT", "try later"]] } }],
  ["top-level Reddit errors", { errors: [["NO_USER", "log in"]] }],
  ["HTTP failure payload", { error: 403 }],
]) {
  test(`rejects ${name} without counting a successful vote`, async () => {
    response.json = async () => body;
    await expect(setVote(item, -1)).rejects.toThrow(
      "Reddit could not confirm the vote",
    );
    expect(statistic).not.toHaveBeenCalled();
  });
}

test("rejects unsuccessful HTTP status even if JSON has no error field", async () => {
  response.ok = false;
  response.status = 500;
  response.json = async () => ({});
  await expect(setVote(item, 1)).rejects.toThrow(
    "Reddit could not confirm the vote",
  );
  expect(statistic).not.toHaveBeenCalled();
});

test("network failure remains a rejected operation", async () => {
  fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(setVote(item, 1)).rejects.toThrow("offline");
  expect(statistic).not.toHaveBeenCalled();
});

test("missing authentication shows one login alert and sends no vote", async () => {
  UserAuth.modhash = undefined;
  await expect(setVote(item, 1)).rejects.toThrow("User is not authenticated");
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(statistic).not.toHaveBeenCalled();
});
