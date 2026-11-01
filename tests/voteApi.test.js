import { beforeEach, expect, mock, test } from "bun:test";

let response;
const request = mock(async () => response);
const statistic = mock(() => {});
const token = mock(async () => "test-token");
mock.module("@sentry/react-native", () => ({ addBreadcrumb: () => {} }));
mock.module("../api/UserAgent", () => ({ USER_AGENT: "test" }));
mock.module("../utils/safeFetch", () => ({ default: request }));
mock.module("../api/gql/WebToken", () => ({
  getWebToken: token,
  refreshWebToken: async () => "renewed-test-token",
  RecentTokenRejectedError: class extends Error {},
}));
mock.module("../api/Posts", () => ({
  VoteOption: { UpVote: 1, NoVote: 0, DownVote: -1 },
}));
mock.module("../db/functions/Stats", () => ({
  modifyStat: statistic,
  Stat: {
    POST_UPVOTES: "post-up",
    POST_DOWNVOTES: "post-down",
    COMMENT_UPVOTES: "comment-up",
    COMMENT_DOWNVOTES: "comment-down",
  },
}));

const { setVote, vote } = await import("../api/gql/Vote");
const item = { name: "t3_example", userVote: 1 };
beforeEach(() => {
  response = {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ data: { updatePostVoteState: { ok: true } } }),
  };
  request.mockClear();
  statistic.mockClear();
  token.mockClear();
});

test("absolute votes preserve the requested state and count successful writes", async () => {
  expect(await setVote(item, 1)).toBe(1);
  const body = JSON.parse(request.mock.calls[0][1].body);
  expect(body.operationName).toBe("UpdatePostVoteState");
  expect(body.variables.input).toEqual({
    postId: "t3_example",
    voteState: "UP",
  });
  expect(statistic).toHaveBeenCalledWith("post-up", 1);
});

test("the existing toggle wrapper removes a selected vote without counting an upvote", async () => {
  expect(await vote(item, 1)).toBe(0);
  expect(
    JSON.parse(request.mock.calls[0][1].body).variables.input.voteState,
  ).toBe("NONE");
  expect(statistic).not.toHaveBeenCalled();
});

test("comment voting retains its separate mutation and statistics", async () => {
  response.text = async () =>
    JSON.stringify({ data: { updateCommentVoteState: { ok: true } } });
  expect(await vote({ name: "t1_comment", userVote: 0 }, -1)).toBe(-1);
  const body = JSON.parse(request.mock.calls[0][1].body);
  expect(body.operationName).toBe("UpdateCommentVoteState");
  expect(body.variables.input).toEqual({
    commentId: "t1_comment",
    voteState: "DOWN",
  });
  expect(statistic).toHaveBeenCalledWith("comment-down", 1);
});

test("Reddit mutation rejection is a failure and preserves its reason", async () => {
  response.text = async () =>
    JSON.stringify({
      data: {
        updatePostVoteState: {
          ok: false,
          fieldErrors: [{ message: "Try again later" }],
        },
      },
    });
  await expect(setVote(item, -1)).rejects.toThrow("Try again later");
  expect(statistic).not.toHaveBeenCalled();
});

test("missing mutation success is not counted as a confirmed vote", async () => {
  response.text = async () => JSON.stringify({ data: {} });
  await expect(setVote(item, 1)).rejects.toThrow("Failed to vote");
  expect(statistic).not.toHaveBeenCalled();
});

test("HTTP failure remains rejected even with a mutation-looking body", async () => {
  response.ok = false;
  response.status = 500;
  await expect(setVote(item, 1)).rejects.toThrow("HTTP 500");
  expect(statistic).not.toHaveBeenCalled();
});

test("invalid JSON cannot confirm a vote", async () => {
  response.text = async () => "not JSON";
  await expect(setVote(item, 1)).rejects.toThrow("Response was not JSON");
  expect(statistic).not.toHaveBeenCalled();
});

test("network failure does not count a successful vote", async () => {
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(setVote(item, 1)).rejects.toThrow("offline");
  expect(statistic).not.toHaveBeenCalled();
});

test("missing authentication prevents the network mutation", async () => {
  token.mockRejectedValueOnce(new Error("Log in to vote"));
  await expect(setVote(item, 1)).rejects.toThrow("Log in to vote");
  expect(request).not.toHaveBeenCalled();
  expect(statistic).not.toHaveBeenCalled();
});
